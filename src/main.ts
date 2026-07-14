import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';

import { discoverLlamaCppServers } from './main/lan-discovery';
import { APP_PROTOCOL, APP_PROTOCOL_HOST, isSafeExternalUrl, isTrustedRendererUrl, resolveRendererAsset } from './main/app-protocol';
import { resolveCodexCommand, type ExecutableCommand } from './main/platform';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import packageJson from '../package.json';
import type { IPty } from 'node-pty';

const pty = require('node-pty') as typeof import('node-pty');

protocol.registerSchemesAsPrivileged([{
  scheme: APP_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
}]);

type SessionStatus = 'running' | 'stopped' | 'failed' | 'completed';
type Provider = 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';

interface SessionState {
  id: string;
  pty: IPty | null;
  repository: string;
  branch: string;
  provider: Provider;
  status: SessionStatus;
  terminalBuffer: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  codexCommand: ExecutableCommand;
  codexThreadId?: string;
  jsonRemainder: string;
  lastStructuredError?: string;
  processedItemIds: Set<string>;
  activePrompt?: string;
  retryFreshAfterExit: boolean;
  protocolRetryUsed: boolean;
}


interface LanProvider {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
}

export interface SessionOptions {
  repository?: string;
  branch?: string;
  codexPath?: string;
  provider?: Provider;
  selectedLanProviderId?: string;
  remoteLlamaCpp?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  ollama?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  lanProvider?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  defaultModel?: string;
  codexThreadId?: string;
}

interface SessionRecord {
  id: string;
  repository: string;
  branch: string;
  provider?: Provider;
  model?: string;
  baseUrl?: string;
  selectedLanProviderId?: string;
  codexThreadId?: string;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
}

type SecretScope = 'all' | 'codex' | 'local';

interface StoredSecret {
  id: string;
  label: string;
  envVar: string;
  encryptedValue: string;
  scope: SecretScope;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SecretInput {
  id?: string;
  label: string;
  envVar: string;
  value?: string;
  scope: SecretScope;
  enabled: boolean;
}

interface AppSettings {
  defaultProvider: Provider;
  ollama: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  remoteLlamaCpp: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  lanProviders: LanProvider[];
  defaultModel?: string;
  localProviderBehavior: {
    isolateProfile: boolean;
    enableWebSearch: boolean;
    enableMultiAgent: boolean;
  };
}

interface PersistedProviderSettings {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  encryptedApiKey?: string;
}

interface PersistedLanProvider extends Omit<LanProvider, 'apiKey'> {
  apiKey?: string;
  encryptedApiKey?: string;
}

interface PersistedAppSettings {
  defaultProvider?: Provider;
  ollama?: PersistedProviderSettings;
  remoteLlamaCpp?: PersistedProviderSettings;
  lanProviders?: PersistedLanProvider[];
  defaultModel?: string;
  localProviderBehavior?: Partial<AppSettings['localProviderBehavior']>;
}

interface PersistedProviderCredentials {
  ollama?: string;
  remoteLlamaCpp?: string;
  lanProviders: Map<string, string>;
}

interface ApprovalRequest {
  id: string;
  sessionId: string;
  command: string;
  workingDir: string;
  sandboxPolicy: string;
  affectedPaths: string[];
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

interface CodexEvent {
  id: string;
  session_id: string;
  type: string;
  content: string;
  timestamp: number;
}

interface HealthCheckItem {
  id: string;
  label: string;
  status: 'checking' | 'ok' | 'warning' | 'error';
  message: string;
  detail?: string;
  checkedAt: number;
}

interface UpdateStatus {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  checkedAt: number;
}

interface StartupStatus {
  appUpdate: UpdateStatus;
  checks: HealthCheckItem[];
  providerSetup: ProviderSetupStatus;
}

interface ProviderSetupStatus {
  ready: boolean;
  codexInstalled: boolean;
  codexAuthenticated: boolean;
  ollamaAvailable: boolean;
  ollamaModels: string[];
  lanAvailable: boolean;
  lanProviderId?: string;
  lanProviderName?: string;
  lanEndpoint?: string;
  lanModel?: string;
  recommendedProvider?: 'default' | 'ollama';
  recommendedModel?: string;
}

let mainWindow: BrowserWindow | null = null;
let storePath = '';
let settingsPath = '';
let secretsPath = '';
let windowStatePath = '';
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let appSettings: AppSettings = {
  defaultProvider: 'default',
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:32b-instruct-q4_K_M',
    apiKey: '',
  },
  remoteLlamaCpp: {
    baseUrl: '',
    model: '',
    apiKey: 'llama.cpp',
  },
  lanProviders: [],
  defaultModel: '',
  localProviderBehavior: {
    isolateProfile: true,
    enableWebSearch: true,
    enableMultiAgent: false,
  },
};
let persistedProviderCredentials: PersistedProviderCredentials = {
  lanProviders: new Map(),
};
const sessions = new Map<string, SessionState>();
const records = new Map<string, SessionRecord>();
const events = new Map<string, CodexEvent[]>();
const approvals = new Map<string, ApprovalRequest>();
const secrets = new Map<string, StoredSecret>();

function isProvider(value: unknown): value is Provider {
  return value === 'default' || value === 'remote_llamacpp' || value === 'gpt56' || value === 'lan' || value === 'ollama';
}

function normalizeProvider(value: unknown, fallback: Provider = appSettings.defaultProvider): Provider {
  return isProvider(value) ? value : fallback;
}


function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function githubReleaseRepo() {
  return process.env.CONSIGLIO_UPDATE_REPO || 'rickenator/Consiglio';
}

async function checkForAppUpdate(): Promise<UpdateStatus> {
  const checkedAt = Date.now();
  const currentVersion = app.getVersion() || (packageJson as { version?: string }).version || '0.0.0';
  const repo = githubReleaseRepo();
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': `Consiglio/${currentVersion}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return { currentVersion, updateAvailable: false, status: 'warning', message: `Could not check GitHub releases for ${repo}: ${response.status} ${response.statusText}`, checkedAt };
    }
    const payload = await response.json().catch(() => null) as { tag_name?: string; html_url?: string; name?: string } | null;
    const latestVersion = payload?.tag_name || payload?.name;
    if (!latestVersion) {
      return { currentVersion, updateAvailable: false, status: 'warning', message: `Latest release for ${repo} did not include a version tag.`, checkedAt };
    }
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: payload?.html_url,
      status: 'ok',
      message: updateAvailable ? `Consiglio ${latestVersion} is available.` : `Consiglio is up to date (${currentVersion}).`,
      checkedAt,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown update check error';
    return { currentVersion, updateAvailable: false, status: 'warning', message: `Could not check for Consiglio updates: ${message}`, checkedAt };
  }
}

function codexReadiness() {
  const checkedAt = Date.now();
  const command = resolveCodexCommand();
  const codexPath = command?.displayPath || process.env.CODEX_BIN || 'codex';
  try {
    if (!command) throw new Error('No Codex executable was found on PATH or in a standard installation directory.');
    const version = execFileSync(command.executable, [...command.prefixArgs, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let authenticated = false;
    let loginMessage = 'Codex is installed but not signed in.';
    const login = spawnSync(command.executable, [...command.prefixArgs, 'login', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const loginOutput = `${login.stdout || ''}\n${login.stderr || ''}`
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith('WARNING:'))
      .join('\n')
      .trim();
    authenticated = login.status === 0 && /logged in/i.test(loginOutput);
    if (loginOutput) loginMessage = loginOutput;
    return { installed: true, authenticated, version, loginMessage, codexPath, checkedAt };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Codex CLI was not found';
    return { installed: false, authenticated: false, version: '', loginMessage: message, codexPath, checkedAt };
  }
}

async function ollamaReadiness() {
  const baseUrl = (appSettings.ollama.baseUrl || 'http://localhost:11434')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { available: false, models: [] as string[], message: `Ollama returned ${response.status}.` };
    const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const models = (payload.models || []).map(model => model.name || model.model || '').filter(Boolean);
    return {
      available: models.length > 0,
      models,
      message: models.length > 0 ? `${models.length} local model${models.length === 1 ? '' : 's'} ready.` : 'Ollama is running, but no models are installed.',
    };
  } catch {
    return { available: false, models: [] as string[], message: 'Ollama was not detected on this computer.' };
  }
}

async function providerReadiness(): Promise<{ checks: HealthCheckItem[]; providerSetup: ProviderSetupStatus }> {
  const codex = codexReadiness();
  const ollama = await ollamaReadiness();
  const checks: HealthCheckItem[] = [
    {
      id: 'codex-cli',
      label: 'Codex CLI',
      status: codex.installed ? 'ok' : 'error',
      message: codex.installed ? codex.version || 'Codex CLI is installed.' : `Codex CLI is unavailable: ${codex.loginMessage}`,
      detail: codex.codexPath,
      checkedAt: codex.checkedAt,
    },
    {
      id: 'codex-login',
      label: 'Codex account',
      status: codex.authenticated ? 'ok' : 'warning',
      message: codex.authenticated ? codex.loginMessage : 'Sign in with `codex login`, or use a local Ollama model.',
      checkedAt: codex.checkedAt,
    },
    {
      id: 'provider-ollama',
      label: 'Free local AI',
      status: ollama.available ? 'ok' : 'warning',
      message: ollama.message,
      detail: appSettings.ollama.baseUrl,
      checkedAt: Date.now(),
    },
  ];
  const checkedAt = Date.now();
  if (appSettings.remoteLlamaCpp.baseUrl) {
    const result = await testRemoteLlamaCpp(appSettings.remoteLlamaCpp.baseUrl, appSettings.remoteLlamaCpp.apiKey, appSettings.remoteLlamaCpp.model);
    checks.push({
      id: 'provider-remote-llamacpp',
      label: 'Remote llama.cpp',
      status: result.ok ? 'ok' : 'warning',
      message: result.message,
      detail: appSettings.remoteLlamaCpp.baseUrl,
      checkedAt,
    });
  }
  let readyLanProvider: LanProvider | undefined;
  for (const provider of appSettings.lanProviders) {
    const baseUrl = lanProviderBaseUrl(provider);
    const result = await testRemoteLlamaCpp(baseUrl, provider.apiKey, provider.model);
    checks.push({
      id: `provider-lan-${provider.id}`,
      label: `LAN provider: ${provider.name}`,
      status: result.ok ? 'ok' : 'warning',
      message: result.message,
      detail: baseUrl,
      checkedAt,
    });
    if (!readyLanProvider && result.ok && provider.model.trim()) readyLanProvider = provider;
  }
  const recommendedProvider = codex.installed && codex.authenticated
    ? 'default' as const
    : codex.installed && ollama.available
      ? 'ollama' as const
      : undefined;
  return {
    checks,
    providerSetup: {
      ready: Boolean(recommendedProvider),
      codexInstalled: codex.installed,
      codexAuthenticated: codex.authenticated,
      ollamaAvailable: ollama.available,
      ollamaModels: ollama.models,
      lanAvailable: Boolean(readyLanProvider),
      lanProviderId: readyLanProvider?.id,
      lanProviderName: readyLanProvider?.name,
      lanEndpoint: readyLanProvider ? lanProviderBaseUrl(readyLanProvider) : undefined,
      lanModel: readyLanProvider?.model,
      recommendedProvider,
      recommendedModel: recommendedProvider === 'ollama' ? ollama.models[0] : undefined,
    },
  };
}

async function runStartupChecks(): Promise<StartupStatus> {
  const appUpdatePromise = checkForAppUpdate();
  let readiness = await providerReadiness();
  if (!readiness.providerSetup.ready && readiness.providerSetup.codexInstalled) {
    await discoverAndSaveLanProviders();
    readiness = await providerReadiness();
  } else if (readiness.providerSetup.codexInstalled) {
    void discoverAndSaveLanProviders().catch(error => console.error('Background LAN discovery failed:', error));
  }
  const appUpdate = await appUpdatePromise;
  return { appUpdate, ...readiness };
}

function createWindow() {
  const windowState = loadWindowState();
  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 960,
    minHeight: 640,
    title: 'Consiglio',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (windowState.maximized) {
    mainWindow.maximize();
  }
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && url !== currentUrl) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.selectionText) {
      template.push({ label: 'Copy', role: 'copy' });
    }
    if (params.isEditable) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push(
        { label: 'Cut', role: 'cut', enabled: Boolean(params.selectionText) },
        { label: 'Paste', role: 'paste' },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll' },
      );
    } else if (!params.selectionText) {
      template.push({ label: 'Select All', role: 'selectAll' });
    }
    Menu.buildFromTemplate(template).popup({ window: mainWindow || undefined });
  });
  void mainWindow.loadURL(`${APP_PROTOCOL}://${APP_PROTOCOL_HOST}/index.html`);
}

function registerRendererProtocol() {
  const rendererRoot = path.join(__dirname, 'renderer');
  protocol.handle(APP_PROTOCOL, request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const assetPath = resolveRendererAsset(rendererRoot, request.url);
    if (!assetPath || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(assetPath).toString(), { method: request.method });
  });
}

function saveStore() {
  if (!storePath) return;
  writeJsonAtomic(storePath, {
    sessions: [...records.values()],
    events: Object.fromEntries(events),
    approvals: [...approvals.values()],
  });
}

function emitSessionUpdate() {
  mainWindow?.webContents.send(
    'codex:sessions-updated',
    [...records.values()].sort((left, right) => right.updated_at - left.updated_at),
  );
}

function secureStorageBackend() {
  if (!safeStorage.isEncryptionAvailable()) return { available: false, backend: 'unavailable' };
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os_keychain';
  return { available: backend !== 'basic_text', backend };
}

function decryptProviderApiKey(encryptedValue?: string, legacyValue?: string) {
  if (encryptedValue && secureStorageBackend().available) {
    try {
      return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
    } catch (error) {
      console.error('Could not decrypt a saved provider credential:', error);
    }
  }
  return legacyValue?.trim() || '';
}

function encryptProviderApiKey(value: string, previousValue?: string) {
  if (!value) return undefined;
  if (!secureStorageBackend().available) return previousValue;
  return safeStorage.encryptString(value).toString('base64');
}

function saveSettings() {
  if (!settingsPath) return;
  const nextCredentials: PersistedProviderCredentials = { lanProviders: new Map() };
  nextCredentials.ollama = encryptProviderApiKey(appSettings.ollama.apiKey, persistedProviderCredentials.ollama);
  nextCredentials.remoteLlamaCpp = encryptProviderApiKey(appSettings.remoteLlamaCpp.apiKey, persistedProviderCredentials.remoteLlamaCpp);
  const lanProviders = appSettings.lanProviders.map(provider => {
    const encryptedApiKey = encryptProviderApiKey(provider.apiKey, persistedProviderCredentials.lanProviders.get(provider.id));
    if (encryptedApiKey) nextCredentials.lanProviders.set(provider.id, encryptedApiKey);
    return {
      id: provider.id,
      name: provider.name,
      host: provider.host,
      port: provider.port,
      model: provider.model,
      encryptedApiKey,
    };
  });
  writeJsonAtomic(settingsPath, {
    defaultProvider: appSettings.defaultProvider,
    ollama: {
      baseUrl: appSettings.ollama.baseUrl,
      model: appSettings.ollama.model,
      encryptedApiKey: nextCredentials.ollama,
    },
    remoteLlamaCpp: {
      baseUrl: appSettings.remoteLlamaCpp.baseUrl,
      model: appSettings.remoteLlamaCpp.model,
      encryptedApiKey: nextCredentials.remoteLlamaCpp,
    },
    lanProviders,
    defaultModel: appSettings.defaultModel,
    localProviderBehavior: appSettings.localProviderBehavior,
  });
  persistedProviderCredentials = nextCredentials;
}

function secretMetadata(secret: StoredSecret) {
  return {
    id: secret.id,
    label: secret.label,
    envVar: secret.envVar,
    scope: secret.scope,
    enabled: secret.enabled,
    hasValue: Boolean(secret.encryptedValue),
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}

function secretsStatus() {
  const storage = secureStorageBackend();
  return {
    available: storage.available,
    backend: storage.backend,
    secure: storage.available,
    secrets: [...secrets.values()].sort((left, right) => left.label.localeCompare(right.label)).map(secretMetadata),
  };
}

function saveSecrets() {
  if (!secretsPath) return;
  writeJsonAtomic(secretsPath, { secrets: [...secrets.values()] });
  fs.chmodSync(secretsPath, 0o600);
}

function initSecrets() {
  secretsPath = path.join(app.getPath('userData'), 'consiglio-secrets.json');
  const saved = readJsonWithFallback<{ secrets?: StoredSecret[] }>([secretsPath]);
  for (const secret of saved?.secrets || []) {
    if (secret.id && secret.envVar && secret.encryptedValue) secrets.set(secret.id, secret);
  }
}

function upsertSecret(input: SecretInput) {
  if (!secureStorageBackend().available) {
    throw new Error('Secure credential storage is unavailable. Unlock or configure the operating-system keyring and restart Consiglio.');
  }
  const envVar = input.envVar?.trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) {
    throw new Error('Environment variable names may contain only letters, numbers, and underscores, and cannot start with a number.');
  }
  const existing = input.id ? secrets.get(input.id) : undefined;
  const duplicate = [...secrets.values()].find(secret => secret.envVar === envVar && secret.id !== existing?.id);
  if (duplicate) throw new Error(`${envVar} is already managed by ${duplicate.label}.`);
  const previousEnvVar = existing?.envVar;
  const value = input.value;
  if (!existing && !value) throw new Error('A secret value is required.');
  const now = Date.now();
  const secret: StoredSecret = {
    id: existing?.id || `secret_${now}_${Math.random().toString(36).slice(2, 8)}`,
    label: input.label?.trim() || envVar,
    envVar,
    encryptedValue: value ? safeStorage.encryptString(value).toString('base64') : existing!.encryptedValue,
    scope: input.scope === 'codex' || input.scope === 'local' ? input.scope : 'all',
    enabled: input.enabled !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  secrets.set(secret.id, secret);
  saveSecrets();
  refreshSessionSecretEnvironments([previousEnvVar, secret.envVar]);
  return secretsStatus();
}

function removeSecret(id: string) {
  const envVar = secrets.get(id)?.envVar;
  const removed = secrets.delete(id);
  if (removed) {
    saveSecrets();
    refreshSessionSecretEnvironments([envVar]);
  }
  return secretsStatus();
}

function applySecretsToEnvironment(env: NodeJS.ProcessEnv, provider: Provider) {
  const isLocal = provider === 'remote_llamacpp' || provider === 'lan' || provider === 'ollama';
  for (const secret of secrets.values()) {
    if (!secret.enabled || (secret.scope === 'local' && !isLocal) || (secret.scope === 'codex' && isLocal)) continue;
    try {
      env[secret.envVar] = safeStorage.decryptString(Buffer.from(secret.encryptedValue, 'base64'));
    } catch (error) {
      console.error(`Could not decrypt credential ${secret.envVar}:`, error);
    }
  }
}

function refreshSessionSecretEnvironments(envVars: Array<string | undefined>) {
  const affected = new Set(envVars.filter((envVar): envVar is string => Boolean(envVar)));
  for (const state of sessions.values()) {
    for (const envVar of affected) {
      if (process.env[envVar] === undefined) delete state.env[envVar];
      else state.env[envVar] = process.env[envVar];
    }
    applySecretsToEnvironment(state.env, state.provider);
  }
}

function writeJsonAtomic(filePath: string, data: unknown) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function readJsonWithFallback<T>(paths: string[]): T | null {
  for (const candidate of paths) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')) as T;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') continue;
      console.error(`Could not read ${candidate}:`, error);
      return null;
    }
  }
  return null;
}

function initStore() {
  storePath = path.join(app.getPath('userData'), 'consiglio-sessions.json');
  const saved = readJsonWithFallback<{
    sessions?: SessionRecord[];
    events?: Record<string, CodexEvent[]>;
    approvals?: ApprovalRequest[];
  }>([
    storePath,
    path.join(app.getPath('userData'), 'consiglier-sessions.json'),
    path.join(app.getPath('userData'), 'codex-control-sessions.json'),
  ]);
  try {
    for (const record of saved?.sessions || []) {
      records.set(record.id, record);
    }
    for (const [sessionId, savedEvents] of Object.entries(saved?.events || {})) {
      events.set(sessionId, savedEvents as CodexEvent[]);
    }
    for (const approval of saved?.approvals || []) {
      approvals.set(approval.id, approval);
    }
  } catch (error: unknown) {
    console.error('Could not load saved sessions:', error);
  }
  for (const record of records.values()) {
    const sessionEvents = events.get(record.id) || [];
    const lastProtocolError = [...sessionEvents]
      .reverse()
      .find(event => event.type === 'error' && /output of tool call should be ['"]?input text/i.test(event.content));
    const lastResponse = [...sessionEvents].reverse().find(event => event.type === 'response');
    if (lastProtocolError && (!lastResponse || lastProtocolError.timestamp > lastResponse.timestamp)) {
      record.codexThreadId = undefined;
    }
    if (record.status === 'running') record.status = 'stopped';
    const lastEvent = [...sessionEvents].reverse().find(event => event.type !== 'system');
    if (lastEvent?.type === 'prompt' || lastEvent?.type === 'tool_call') {
      sessionEvents.push({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        session_id: record.id,
        type: 'interrupted',
        content: 'The previous response was interrupted. Continue on the same Codex thread when you are ready.',
        timestamp: Date.now(),
      });
      events.set(record.id, sessionEvents.slice(-500));
    }
  }
  saveStore();
}

function initSettings() {
  settingsPath = path.join(app.getPath('userData'), 'consiglio-settings.json');
  const saved = readJsonWithFallback<PersistedAppSettings>([
    settingsPath,
    path.join(app.getPath('userData'), 'consiglier-settings.json'),
    path.join(app.getPath('userData'), 'codex-control-settings.json'),
  ]);
  try {
    if (saved) {
      persistedProviderCredentials = {
        ollama: saved.ollama?.encryptedApiKey,
        remoteLlamaCpp: saved.remoteLlamaCpp?.encryptedApiKey,
        lanProviders: new Map(
          (saved.lanProviders || [])
            .filter(provider => provider.id && provider.encryptedApiKey)
            .map(provider => [provider.id, provider.encryptedApiKey!]),
        ),
      };
      appSettings = {
        defaultProvider: normalizeProvider(saved.defaultProvider),
        ollama: {
          baseUrl: saved.ollama?.baseUrl?.trim() || appSettings.ollama.baseUrl,
          model: saved.ollama?.model?.trim() || appSettings.ollama.model,
          apiKey: decryptProviderApiKey(saved.ollama?.encryptedApiKey, saved.ollama?.apiKey) || appSettings.ollama.apiKey,
        },
        remoteLlamaCpp: {
          baseUrl: saved.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl,
          model: saved.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model,
          apiKey: decryptProviderApiKey(saved.remoteLlamaCpp?.encryptedApiKey, saved.remoteLlamaCpp?.apiKey) || appSettings.remoteLlamaCpp.apiKey,
        },
        lanProviders: Array.isArray(saved.lanProviders)
          ? saved.lanProviders.map(provider => ({
              id: provider.id,
              name: provider.name,
              host: provider.host,
              port: provider.port,
              model: provider.model,
              apiKey: decryptProviderApiKey(provider.encryptedApiKey, provider.apiKey),
            }))
          : [],
        defaultModel: saved.defaultModel?.trim() || appSettings.defaultModel,
        localProviderBehavior: {
          isolateProfile: saved.localProviderBehavior?.isolateProfile !== false,
          enableWebSearch: saved.localProviderBehavior?.enableWebSearch !== false,
          enableMultiAgent: saved.localProviderBehavior?.enableMultiAgent === true,
        },
      };
    }
  } catch (error: unknown) {
    console.error('Could not load settings:', error);
  }
  saveSettings();
}

function loadWindowState() {
  windowStatePath = path.join(app.getPath('userData'), 'consiglio-window-state.json');
  const fallback = { bounds: { width: 1440, height: 920 }, maximized: false };
  const saved = readJsonWithFallback<{
    bounds?: { x?: number; y?: number; width?: number; height?: number };
    maximized?: boolean;
  }>([
    windowStatePath,
    path.join(app.getPath('userData'), 'consiglier-window-state.json'),
    path.join(app.getPath('userData'), 'codex-control-window-state.json'),
  ]);
  if (saved) {
    return {
      bounds: {
        x: typeof saved.bounds?.x === 'number' ? saved.bounds.x : undefined,
        y: typeof saved.bounds?.y === 'number' ? saved.bounds.y : undefined,
        width: typeof saved.bounds?.width === 'number' ? saved.bounds.width : fallback.bounds.width,
        height: typeof saved.bounds?.height === 'number' ? saved.bounds.height : fallback.bounds.height,
      },
      maximized: Boolean(saved.maximized),
    };
  }
  return fallback;
}

function saveWindowState(window: BrowserWindow | null) {
  if (!window || !windowStatePath) return;
  const data = {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
  };
  writeJsonAtomic(windowStatePath, data);
}

function recordEvent(sessionId: string, type: string, content: string) {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    session_id: sessionId,
    type,
    content,
    timestamp: Date.now(),
  };
  if (type !== 'output') {
    const sessionEvents = events.get(sessionId) || [];
    sessionEvents.push(event);
    events.set(sessionId, sessionEvents.slice(-500));
    saveStore();
  }
  mainWindow?.webContents.send('codex:event', event);
  // Emit approval request events for approval_request types
  if (type === 'approval_request') {
    try {
      const approvalData = JSON.parse(content) as ApprovalRequest;
      approvals.set(approvalData.id, approvalData);
      saveStore();
      mainWindow?.webContents.send('codex:approval-request', approvalData);
    } catch {
      // Not a valid approval request JSON, skip
    }
  }
  return event;
}

function terminalOutput(sessionId: string, data: string) {
  const state = sessions.get(sessionId);
  if (state) {
    state.terminalBuffer = (state.terminalBuffer + data).slice(-1_000_000);
    consumeExecEvents(state, data);
  }
  mainWindow?.webContents.send('codex:terminal-output', { sessionId, data });
}

function consumeExecEvents(state: SessionState, data: string) {
  const combined = state.jsonRemainder + data;
  const lines = combined.split(/\r?\n/);
  state.jsonRemainder = lines.pop() || '';
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        thread_id?: string;
        message?: string;
        error?: { message?: string };
        item?: {
          id?: string;
          type?: string;
          text?: string;
          content?: string;
          aggregated_output?: string;
          command?: string;
          exit_code?: number | null;
        };
      };
      if (event.type === 'item.completed' && event.item?.id) {
        if (state.processedItemIds.has(event.item.id)) continue;
        state.processedItemIds.add(event.item.id);
      }
      if (event.type === 'thread.started' && event.thread_id) {
        state.codexThreadId = event.thread_id;
        const record = records.get(state.id);
        if (record) {
          record.codexThreadId = event.thread_id;
          record.updated_at = Date.now();
          saveStore();
        }
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const text = typeof event.item.text === 'string' ? event.item.text : event.item.content;
        if (text?.trim()) recordEvent(state.id, 'response', text.trim());
      }
      if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
        recordEvent(state.id, 'tool_call', event.item.command || 'Ran a command');
        const imagePaths = extractWorkspaceImages(state.repository, event.item.aggregated_output || '');
        if (imagePaths.length > 0) {
          recordEvent(state.id, 'files', JSON.stringify({ paths: imagePaths }));
        }
      }
      if (event.type === 'error' && event.message) {
        recordStructuredError(state, event.message);
      }
      if (event.type === 'turn.failed' && event.error?.message) {
        recordStructuredError(state, event.error.message);
      }
    } catch {
      // The PTY can split JSONL across chunks; incomplete fragments are retained above.
    }
  }
}

function recordStructuredError(state: SessionState, message: string) {
  const clean = decodeStructuredError(message);
  if (!clean || clean === state.lastStructuredError) return;
  state.lastStructuredError = clean;
  const incompatibleToolOutput = /output of tool call should be ['"]?input text/i.test(clean);
  if (incompatibleToolOutput) {
    state.codexThreadId = undefined;
    const record = records.get(state.id);
    if (record) {
      record.codexThreadId = undefined;
      record.updated_at = Date.now();
      saveStore();
    }
    const canRetryFresh = state.provider === 'remote_llamacpp' || state.provider === 'lan' || state.provider === 'ollama';
    if (canRetryFresh && state.activePrompt && !state.protocolRetryUsed) {
      state.protocolRetryUsed = true;
      state.retryFreshAfterExit = true;
      recordEvent(state.id, 'system', 'The local provider rejected the saved tool state. Retrying this message on a fresh thread.');
      return;
    }
  }
  recordEvent(state.id, 'error', clean);
}

function decodeStructuredError(message: string) {
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string } };
    return parsed.error?.message || message;
  } catch {
    return message;
  }
}

function extractWorkspaceImages(repository: string, output: string) {
  const root = path.resolve(repository);
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(candidate => path.resolve(candidate))
    .filter(candidate => candidate === root || candidate.startsWith(`${root}${path.sep}`))
    .filter(candidate => /\.(png|jpe?g|gif|webp|bmp)$/i.test(candidate) && fs.existsSync(candidate))
    .slice(0, 12);
}

function findWorkspaceImages(repository: string, limit = 12, query = '') {
  const images: string[] = [];
  const wantsBrandAsset = /\b(logos?|icons?|branding|app icon)\b/i.test(query);
  const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', 'target', '__pycache__']);
  const visit = (directory: string, depth: number) => {
    if (images.length >= limit || depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (images.length >= limit) break;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(fullPath, depth + 1);
      } else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(entry.name)) {
        if (!wantsBrandAsset || /\b(icon|logo)\b/i.test(entry.name) || /[\\/]icons?[\\/]/i.test(fullPath)) images.push(fullPath);
      }
    }
  };
  visit(path.resolve(repository), 0);
  return images.sort((left, right) => {
    const leftScore = /[\\/]build[\\/]icons?[\\/]/i.test(left) ? 0 : 1;
    const rightScore = /[\\/]build[\\/]icons?[\\/]/i.test(right) ? 0 : 1;
    return leftScore - rightScore || left.length - right.length || left.localeCompare(right);
  });
}

function isImageDisplayRequest(sessionId: string, prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  if (/\b(show|display|preview|open|view)\b.*\b(images?|pictures?|photos?|logos?|icons?|branding)\b/.test(normalized)) return true;
  if (!/^(do|show|try) (it|that) again[.!]?$/i.test(normalized)) return false;
  const previousPrompt = [...(events.get(sessionId) || [])]
    .reverse()
    .find(event => event.type === 'prompt');
  return Boolean(previousPrompt && /\b(images?|pictures?|photos?)\b/i.test(previousPrompt.content));
}

function getPendingApprovals(sessionId?: string) {
  return [...approvals.values()]
    .filter(approval => approval.status === 'pending')
    .filter(approval => !sessionId || approval.sessionId === sessionId)
    .sort((left, right) => right.timestamp - left.timestamp);
}

function approveCommand(approvalId: string) {
  const approval = approvals.get(approvalId);
  if (!approval) return false;
  approval.status = 'approved';
  approvals.set(approvalId, approval);
  saveStore();
  mainWindow?.webContents.send('codex:approval-processed', { id: approvalId, approved: true });
  return true;
}

function rejectCommand(approvalId: string) {
  const approval = approvals.get(approvalId);
  if (!approval) return false;
  approval.status = 'rejected';
  approvals.set(approvalId, approval);
  saveStore();
  mainWindow?.webContents.send('codex:approval-processed', { id: approvalId, approved: false });
  return true;
}

function getBranch(repository: string) {
  try {
    return git(repository, ['branch', '--show-current']).trim();
  } catch {
    return '';
  }
}

function git(repository: string, args: string[]) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitStatus(repository: string) {
  return git(repository, ['status', '--porcelain']).split('\n').filter(Boolean).map(line => ({
    x: line[0] || ' ',
    y: line[1] || ' ',
    path: line.slice(3),
  }));
}

function gitDiff(repository: string, filePath: string) {
  return git(repository, ['diff', '--', filePath]);
}

function quoteTomlString(value: string) {
  return JSON.stringify(value);
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function lanProviderBaseUrl(lanProvider: Pick<LanProvider, 'host' | 'port'>) {
  const host = lanProvider.host.trim().replace(/\/+$/, '');
  const port = String(lanProvider.port).trim();

  if (/^https?:\/\//i.test(host)) {
    const url = new URL(host);
    if (!url.port && port) {
      url.port = port;
    }
    return normalizeBaseUrl(url.toString());
  }

  return normalizeBaseUrl(`http://${host}:${port}`);
}

async function fetchModels(baseUrl: string, apiKey?: string): Promise<{ id: string; name?: string }[]> {
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(`${normalized}/models`, { method: 'GET', signal: controller.signal, headers });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map((m: { id?: string; name?: string }) => ({ id: m.id || '', name: m.name || m.id })).filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverAndSaveLanProviders() {
  const discovered = await discoverLlamaCppServers();
  const existingKeys = new Set(appSettings.lanProviders.map(provider => `${provider.host}:${provider.port}`));
  let added = 0;
  for (const server of discovered) {
    const key = `${server.host}:${server.port}`;
    if (existingKeys.has(key)) continue;
    const baseUrl = `http://${server.host}:${server.port}`;
    const models = await fetchModels(baseUrl, 'llama.cpp');
    const model = models[0]?.id?.trim();
    if (!model) continue;
    appSettings.lanProviders.push({
      id: `lan-${Date.now()}-${added}`,
      name: server.name,
      host: server.host,
      port: server.port,
      model,
      apiKey: 'llama.cpp',
    });
    existingKeys.add(key);
    added += 1;
  }
  if (added > 0) {
    saveSettings();
    mainWindow?.webContents.send('settings:changed', appSettings);
  }
  return { found: discovered.length, added, providers: appSettings.lanProviders };
}

function getLanProvider(id?: string): LanProvider | null {
  if (!id || appSettings.lanProviders.length === 0) return null;
  const found = appSettings.lanProviders.find(p => p.id === id);
  return found ?? appSettings.lanProviders[0] ?? null;
}

async function testRemoteLlamaCpp(baseUrl: string, apiKey: string, model?: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${normalizedBaseUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey || 'llama.cpp'}`,
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `Server returned ${response.status} ${response.statusText}`,
      };
    }

    const payload = await response.json().catch(() => null) as { data?: Array<{ id?: string }>; } | null;
    const knownModels = (payload?.data || []).map(entry => entry.id).filter(Boolean) as string[];
    if (model && knownModels.length > 0 && !knownModels.includes(model)) {
      return {
        ok: true,
        message: `Connected, but model ${model} is not listed in /models.`,
      };
    }

    return {
      ok: true,
      message: `Connected to ${normalizedBaseUrl}.`,
      models: knownModels,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown network error';
    return {
      ok: false,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function gitHunks(repository: string, filePath: string) {
  const lines = gitDiff(repository, filePath).split('\n');
  const hunks: Array<{ id: number; header: string; content: string }> = [];
  let current: { id: number; header: string; content: string } | null = null;
  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      if (current) hunks.push(current);
      current = { id: hunks.length, header: line, content: '' };
    } else if (current) {
      current.content += line + '\n';
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function gitApplyHunk(repository: string, filePath: string, hunkId: number, reverse = false) {
  const hunks = gitHunks(repository, filePath);
  const hunk = hunks.find(entry => entry.id === hunkId);
  if (!hunk) {
    return `Error: hunk ${hunkId} not found for ${filePath}`;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const patch = [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    hunk.header,
    hunk.content.replace(/\n$/, ''),
    '',
  ].join('\n');

  try {
    execFileSync('git', ['-C', repository, 'apply', '--recount', '--whitespace=nowarn', reverse ? '-R' : '-'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: patch,
    });
    return 'OK';
  } catch (error: unknown) {
    const candidate = error as { stderr?: { toString?: () => string }; message?: string };
    const stderr = candidate?.stderr?.toString?.().trim?.();
    return stderr || candidate.message || 'Failed to apply hunk';
  }
}

function startSession(options: SessionOptions) {
  const provider = options.provider || appSettings.defaultProvider;
  const repository = path.resolve(options.repository || defaultWorkspacePath());
  if (!fs.statSync(repository).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${repository}`);
  }
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return launchSession(sessionId, repository, options.branch || getBranch(repository), provider, options, false);
}

function defaultWorkspacePath() {
  if (!app.isPackaged) return process.cwd();
  const candidates = [
    path.join(app.getPath('documents'), 'Consiglio Workspace'),
    path.join(app.getPath('userData'), 'workspace'),
  ];
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      return candidate;
    } catch {
      // Try the application-data fallback when the documents directory is protected.
    }
  }
  throw new Error('Consiglio could not create a writable default workspace. Choose a folder and try again.');
}

function launchSession(
  sessionId: string,
  repository: string,
  branch: string,
  provider: Provider,
  options: SessionOptions,
  isReconnect: boolean,
) {
  const codexCommand = resolveCodexCommand({ requested: options.codexPath });
  if (!codexCommand) {
    throw new Error('Codex CLI was not found. Install Codex, add it to PATH, or set CODEX_BIN to its executable path.');
  }
  const previousRecord = records.get(sessionId);
  const args: string[] = [];
  const env = { ...process.env };
  applySecretsToEnvironment(env, provider);
  const isLocalOpenAiCompatibleProvider = provider === 'remote_llamacpp' || provider === 'lan';
  if (isLocalOpenAiCompatibleProvider) {
    const behavior = appSettings.localProviderBehavior;
    if (behavior.isolateProfile) {
      const profileHome = path.join(app.getPath('userData'), 'local-provider-profiles', sessionId);
      fs.mkdirSync(profileHome, { recursive: true });
      env.CODEX_HOME = profileHome;
    }
    args.push(
      '-c', `features.multi_agent=${behavior.enableMultiAgent}`,
      '-c', 'model_supports_reasoning_summaries=false',
      '-c', 'model_reasoning_summary="none"',
    );
    if (!behavior.enableWebSearch) {
      args.push('-c', 'web_search="disabled"');
    }
  }
  const resolvedRemote = {
    baseUrl: provider === 'remote_llamacpp'
      ? options.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl
      : '',
    model: provider === 'remote_llamacpp'
      ? options.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model
      : '',
    apiKey: provider === 'remote_llamacpp'
      ? options.remoteLlamaCpp?.apiKey?.trim() || appSettings.remoteLlamaCpp.apiKey
      : '',
  };

  if (provider === 'remote_llamacpp') {
    if (!resolvedRemote.baseUrl) {
      throw new Error('Remote llama.cpp base URL is required');
    }
    if (!resolvedRemote.model) {
      throw new Error('Remote llama.cpp model is required');
    }

    const normalizedBaseUrl = normalizeBaseUrl(resolvedRemote.baseUrl);
    const apiKey = resolvedRemote.apiKey || 'llama.cpp';

    env.OPENAI_BASE_URL = normalizedBaseUrl;
    env.OPENAI_API_BASE = normalizedBaseUrl;
    env.OPENAI_API_KEY = apiKey;
    env.OPENAI_MODEL = resolvedRemote.model;
    env.CODEX_OSS_BASE_URL = normalizedBaseUrl;

    args.push(
      '-c', `model=${quoteTomlString(resolvedRemote.model)}`,
      '-c', 'model_provider="remote_llamacpp"',
      '-c', 'model_providers.remote_llamacpp.name="Remote llama.cpp"',
      '-c', `model_providers.remote_llamacpp.base_url=${quoteTomlString(normalizedBaseUrl)}`,
      '-c', 'model_providers.remote_llamacpp.wire_api="responses"',
      '-c', 'model_providers.remote_llamacpp.env_key="OPENAI_API_KEY"',
    );
  }
  if (provider === 'default') {
    const defaultModel = options.defaultModel?.trim() || appSettings.defaultModel?.trim();
    if (defaultModel) {
      env.OPENAI_MODEL = defaultModel;
      args.push('-c', `model=${quoteTomlString(defaultModel)}`);
    }
  }
  if (provider === 'ollama') {
    const ollamaModel = options.ollama?.model?.trim() || appSettings.ollama.model;
    const ollamaBaseUrl = normalizeBaseUrl(appSettings.ollama.baseUrl);

    env.OPENAI_BASE_URL = ollamaBaseUrl;
    env.OPENAI_API_BASE = ollamaBaseUrl;
    env.OPENAI_API_KEY = appSettings.ollama.apiKey || 'ollama';
    env.OPENAI_MODEL = ollamaModel;
    env.CODEX_OSS_BASE_URL = ollamaBaseUrl;

    args.push(
      '-c', `model=${quoteTomlString(ollamaModel)}`,
      '-c', 'model_provider="ollama"',
      '-c', 'model_providers.ollama.name="Ollama"',
      '-c', `model_providers.ollama.base_url=${quoteTomlString(ollamaBaseUrl)}`,
      '-c', 'model_providers.ollama.wire_api="responses"',
      '-c', 'model_providers.ollama.env_key="OPENAI_API_KEY"',
    );
  }
  if (provider === 'gpt56') {
    args.push('-m', 'gpt-5.6');
  }
  if (provider === 'lan') {
    const lanProvider = getLanProvider(options.selectedLanProviderId);
    if (!lanProvider) throw new Error('No LAN provider configured');

    const lanHost = lanProvider.host.trim();
    if (!lanHost) {
      throw new Error('LAN provider host is required');
    }
    const lanModel = lanProvider.model.trim() || appSettings.defaultModel?.trim() || '';

    const normalizedBaseUrl = lanProviderBaseUrl(lanProvider);
    const apiKey = lanProvider.apiKey || 'llama.cpp';

    env.OPENAI_BASE_URL = normalizedBaseUrl;
    env.OPENAI_API_BASE = normalizedBaseUrl;
    env.OPENAI_API_KEY = apiKey;
    env.OPENAI_MODEL = lanModel;
    env.CODEX_OSS_BASE_URL = normalizedBaseUrl;

    args.push(
      '-c', `model=${quoteTomlString(lanModel)}`,
      '-c', 'model_provider="lan"',
      '-c', 'model_providers.lan.name=lan',
      '-c', `model_providers.lan.base_url=${quoteTomlString(normalizedBaseUrl)}`,
      '-c', 'model_providers.lan.wire_api="responses"',
      '-c', 'model_providers.lan.env_key="OPENAI_API_KEY"',
    );

  }

  const state: SessionState = {
    id: sessionId,
    pty: null,
    repository,
    branch,
    provider,
    status: 'running',
    terminalBuffer: '',
    args,
    env,
    codexCommand,
    codexThreadId: options.codexThreadId,
    jsonRemainder: '',
    lastStructuredError: undefined,
    processedItemIds: new Set(),
    activePrompt: undefined,
    retryFreshAfterExit: false,
    protocolRetryUsed: false,
  };
  sessions.set(sessionId, state);
  records.set(sessionId, {
    id: sessionId,
    repository,
    branch,
    provider,
    model: provider === 'remote_llamacpp' ? resolvedRemote.model : 
           provider === 'lan' ? (getLanProvider(options.selectedLanProviderId)?.model.trim() || appSettings.defaultModel?.trim()) :
           provider === 'default' ? (options.defaultModel?.trim() || appSettings.defaultModel?.trim()) :
           provider === 'ollama' ? (options.ollama?.model?.trim() || appSettings.ollama.model) :
           provider === 'gpt56' ? 'gpt-5.6' :
           undefined,
    baseUrl: provider === 'remote_llamacpp'
      ? normalizeBaseUrl(resolvedRemote.baseUrl)
      : provider === 'ollama'
        ? normalizeBaseUrl(appSettings.ollama.baseUrl)
        : provider === 'lan' && getLanProvider(options.selectedLanProviderId)
        ? lanProviderBaseUrl(getLanProvider(options.selectedLanProviderId)!)
        : undefined,
    selectedLanProviderId: options.selectedLanProviderId || previousRecord?.selectedLanProviderId,
    codexThreadId: options.codexThreadId,
    status: 'running',
    created_at: previousRecord?.created_at || Date.now(),
    updated_at: Date.now(),
  });
  saveStore();
  emitSessionUpdate();
  recordEvent(sessionId, 'system', `${isReconnect ? 'Reconnected' : 'Ready'} in ${repository}`);
  return { sessionId, repository, branch };
}

function stopSession(sessionId: string) {
  const state = sessions.get(sessionId);
  if (!state) return false;
  state.pty?.kill();
  sessions.delete(sessionId);
  const record = records.get(sessionId);
  if (record) { record.status = 'stopped'; record.updated_at = Date.now(); }
  saveStore();
  emitSessionUpdate();
  return true;
}


function deleteSession(sessionId: string) {
  const state = sessions.get(sessionId);
  if (state) { try { state.pty?.kill(); } catch {} sessions.delete(sessionId); }
  records.delete(sessionId);
  events.delete(sessionId);
  saveStore();
  emitSessionUpdate();
  return true;
}

function sendSessionPrompt(sessionId: string, input: string) {
  const state = sessions.get(sessionId);
  const prompt = input.trim();
  if (!state || !prompt || state.pty) return false;

  const shouldDisplayImages = isImageDisplayRequest(sessionId, prompt);
  recordEvent(sessionId, 'prompt', prompt);
  const record = records.get(sessionId);
  if (record) {
    record.updated_at = Date.now();
    saveStore();
    emitSessionUpdate();
  }
  if (shouldDisplayImages) {
    const imagePaths = findWorkspaceImages(state.repository, 12, prompt);
    if (imagePaths.length === 0) {
      recordEvent(sessionId, 'response', 'No previewable images were found in this task directory.');
    } else {
      recordEvent(sessionId, 'response', `Showing ${imagePaths.length} representative image${imagePaths.length === 1 ? '' : 's'} from this task.`);
      recordEvent(sessionId, 'files', JSON.stringify({ paths: imagePaths }));
    }
    return true;
  }

  state.activePrompt = prompt;
  state.retryFreshAfterExit = false;
  state.protocolRetryUsed = false;
  launchPromptProcess(state, prompt);
  return true;
}

function launchPromptProcess(state: SessionState, prompt: string) {
  const commandArgs = state.codexThreadId
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...state.args, state.codexThreadId, prompt]
    : ['exec', '--json', '--skip-git-repo-check', ...state.args, prompt];
  state.jsonRemainder = '';
  state.lastStructuredError = undefined;
  state.processedItemIds.clear();
  const terminal = pty.spawn(state.codexCommand.executable, [...state.codexCommand.prefixArgs, ...commandArgs], {
    name: 'xterm-256color',
    cols: 120,
    rows: 36,
    cwd: state.repository,
    env: state.env,
  });
  state.pty = terminal;
  terminal.onData((data: string) => terminalOutput(state.id, data));
  terminal.onExit(({ exitCode }: { exitCode: number }) => {
    state.pty = null;
    if (state.jsonRemainder.trim()) {
      consumeExecEvents(state, `${state.jsonRemainder}\n`);
      state.jsonRemainder = '';
    }
    if (state.retryFreshAfterExit && state.activePrompt) {
      state.retryFreshAfterExit = false;
      launchPromptProcess(state, state.activePrompt);
      return;
    }
    if (exitCode !== 0 && !state.lastStructuredError) {
      const detail = terminalFailureDetail(state.terminalBuffer);
      recordEvent(state.id, 'error', detail || `Codex stopped with code ${exitCode}. Check the provider settings and try again.`);
    }
    state.activePrompt = undefined;
  });
}

function terminalFailureDetail(buffer: string) {
  const lines = buffer
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('{'));
  const uniqueLines = lines.filter((line, index) => lines.indexOf(line) === index);
  return uniqueLines.slice(-4).join(' ').slice(0, 600);
}

function resolveSessionPath(sessionId: string, candidatePath: string) {
  const repository = sessions.get(sessionId)?.repository || records.get(sessionId)?.repository;
  if (!repository) throw new Error('Task workspace is unavailable');
  const root = path.resolve(repository);
  const resolved = path.resolve(root, candidatePath || '.');
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path is outside the task workspace');
  }
  return { root, resolved };
}

function resolveKnownWorkspace(candidatePath: string) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) throw new Error('A task workspace is required');
  const resolved = fs.realpathSync.native(path.resolve(candidatePath));
  const known = [...records.values()].some(record => {
    try {
      return fs.realpathSync.native(path.resolve(record.repository)) === resolved;
    } catch {
      return false;
    }
  });
  if (!known) throw new Error('Path is not a registered task workspace');
  return resolved;
}

function resolveGitPath(repository: string, candidatePath: string) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) throw new Error('A repository-relative path is required');
  const resolved = path.resolve(repository, candidatePath);
  if (resolved !== repository && !resolved.startsWith(`${repository}${path.sep}`)) {
    throw new Error('Git path is outside the task workspace');
  }
  return path.relative(repository, resolved);
}

function listWorkspaceFiles(sessionId: string, relativePath = '') {
  const { root, resolved } = resolveSessionPath(sessionId, relativePath);
  return fs.readdirSync(resolved, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
    .slice(0, 500)
    .map(entry => ({
      name: entry.name,
      path: path.relative(root, path.join(resolved, entry.name)),
      isDirectory: entry.isDirectory(),
      isImage: !entry.isDirectory() && /\.(png|jpe?g|gif|webp|bmp)$/i.test(entry.name),
    }));
}

function readWorkspaceFile(sessionId: string, candidatePath: string) {
  const { root, resolved } = resolveSessionPath(sessionId, candidatePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Path is not a file');
  if (stat.size > 20 * 1024 * 1024) throw new Error('File is too large to preview');
  const relativePath = path.relative(root, resolved);
  const extension = path.extname(resolved).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  const mimeType = mimeTypes[extension];
  if (mimeType) {
    return { kind: 'image', path: relativePath, dataUrl: `data:${mimeType};base64,${fs.readFileSync(resolved).toString('base64')}` };
  }
  return { kind: 'text', path: relativePath, text: fs.readFileSync(resolved, 'utf8').slice(0, 1_000_000) };
}

async function addSessionAttachments(sessionId: string) {
  const repository = sessions.get(sessionId)?.repository || records.get(sessionId)?.repository;
  if (!repository) throw new Error('Task workspace is unavailable');
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Add documents to this task',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents and images', extensions: ['pdf', 'md', 'markdown', 'txt', 'rtf', 'csv', 'json', 'yaml', 'yml', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];

  const attachmentDirectory = path.join(repository, '.consiglio', 'attachments');
  fs.mkdirSync(attachmentDirectory, { recursive: true });
  excludeTaskAttachmentsFromGit(repository);
  return result.filePaths.map(sourcePath => {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error(`${path.basename(sourcePath)} is not a file.`);
    if (stat.size > 100 * 1024 * 1024) throw new Error(`${path.basename(sourcePath)} is larger than the 100 MB attachment limit.`);
    const originalName = path.basename(sourcePath).replace(/[\x00-\x1f]/g, '').trim() || 'attachment';
    const extension = path.extname(originalName);
    const stem = path.basename(originalName, extension);
    let destination = path.join(attachmentDirectory, originalName);
    let suffix = 2;
    while (fs.existsSync(destination)) {
      destination = path.join(attachmentDirectory, `${stem} ${suffix}${extension}`);
      suffix += 1;
    }
    fs.copyFileSync(sourcePath, destination);
    return {
      name: path.basename(destination),
      path: path.relative(repository, destination),
      size: stat.size,
      kind: attachmentKind(destination),
    };
  });
}

function excludeTaskAttachmentsFromGit(repository: string) {
  try {
    const gitPath = execFileSync('git', ['-C', repository, 'rev-parse', '--git-path', 'info/exclude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const excludePath = path.isAbsolute(gitPath) ? gitPath : path.resolve(repository, gitPath);
    const contents = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
    if (!contents.split(/\r?\n/).includes('.consiglio/')) {
      fs.mkdirSync(path.dirname(excludePath), { recursive: true });
      fs.appendFileSync(excludePath, `${contents.endsWith('\n') || contents.length === 0 ? '' : '\n'}.consiglio/\n`);
    }
  } catch {
    // Non-git workspaces do not need a local exclude rule.
  }
}

function attachmentKind(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (/^\.(png|jpe?g|gif|webp|bmp|svg)$/.test(extension)) return 'image';
  if (extension === '.pdf') return 'pdf';
  if (/^\.(md|markdown|txt|rtf|csv|json|ya?ml)$/.test(extension)) return 'text';
  return 'file';
}

type IpcMainHandler = Parameters<typeof ipcMain.handle>[1];

function handleIpc(channel: string, handler: IpcMainHandler) {
  ipcMain.handle(channel, (event, ...args) => {
    const senderUrl = event.senderFrame?.url || event.sender.getURL();
    const isMainFrame = Boolean(
      mainWindow
      && event.sender === mainWindow.webContents
      && event.senderFrame === mainWindow.webContents.mainFrame,
    );
    if (!isMainFrame || !isTrustedRendererUrl(senderUrl)) {
      throw new Error(`Rejected IPC ${channel} from an untrusted renderer`);
    }
    return handler(event, ...args);
  });
}

handleIpc('session:start', (_event, options: SessionOptions) => startSession(options || {}));
handleIpc('session:stop', (_event, sessionId: string) => stopSession(sessionId));
handleIpc('session:delete', (_event, sessionId: string) => deleteSession(sessionId));
handleIpc('session:list', () => [...records.values()].sort((left, right) => right.updated_at - left.updated_at));
handleIpc('session:events', (_event, sessionId: string) => events.get(sessionId) || []);
handleIpc('session:terminal-buffer', (_event, sessionId: string) => sessions.get(sessionId)?.terminalBuffer || '');
handleIpc('session:send-input', (_event, { sessionId, input }: { sessionId: string; input: string }) => {
  return sendSessionPrompt(sessionId, input);
});
handleIpc('workspace:list-files', (_event, { sessionId, path: relativePath }: { sessionId: string; path?: string }) => {
  return listWorkspaceFiles(sessionId, relativePath);
});
handleIpc('workspace:read-file', (_event, { sessionId, path: filePath }: { sessionId: string; path: string }) => {
  return readWorkspaceFile(sessionId, filePath);
});
handleIpc('workspace:add-attachments', (_event, sessionId: string) => addSessionAttachments(sessionId));
handleIpc('session:resize', (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
  const state = sessions.get(sessionId);
  if (!state) return false;
  state.pty?.resize(Math.max(2, Math.min(500, cols)), Math.max(2, Math.min(500, rows)));
  return true;
});
handleIpc('session:reconnect', (_event, sessionId: string) => {
  const record = records.get(sessionId);
  if (!record || sessions.has(sessionId)) return false;
  const branch = record.branch || getBranch(record.repository);
  launchSession(sessionId, record.repository, branch, record.provider || appSettings.defaultProvider, {
    repository: record.repository,
    branch,
    provider: record.provider,
    remoteLlamaCpp: record.provider === 'remote_llamacpp'
      ? {
          baseUrl: record.baseUrl,
          model: record.model,
          apiKey: appSettings.remoteLlamaCpp.apiKey,
        }
      : undefined,
    selectedLanProviderId: record.selectedLanProviderId,
    codexThreadId: record.codexThreadId,
  }, true);
  const updated = records.get(sessionId);
  if (updated) {
    updated.status = 'running';
    updated.updated_at = Date.now();
    records.set(sessionId, updated);
    saveStore();
  }
  emitSessionUpdate();
  // Notify UI about recovered sessions
  const recoveredIds = [...sessions.keys()];
  if (recoveredIds.length > 0) {
    mainWindow?.webContents.send('codex:sessions-recovered', recoveredIds);
  }
  return true;
});

handleIpc('git:status', (_event, repository: string) => gitStatus(resolveKnownWorkspace(repository)));
handleIpc('git:diff', (_event, repository: string, filePath: string) => {
  const workspace = resolveKnownWorkspace(repository);
  return gitDiff(workspace, resolveGitPath(workspace, filePath));
});
handleIpc('git:branch', (_event, repository: string) => getBranch(resolveKnownWorkspace(repository)));
handleIpc('git:hunks', (_event, repository: string, filePath: string) => {
  const workspace = resolveKnownWorkspace(repository);
  return gitHunks(workspace, resolveGitPath(workspace, filePath));
});
handleIpc('git:apply-hunk', (_event, repository: string, filePath: string, hunkId: number) => {
  const workspace = resolveKnownWorkspace(repository);
  return gitApplyHunk(workspace, resolveGitPath(workspace, filePath), hunkId, false);
});
handleIpc('git:reject-hunk', (_event, repository: string, filePath: string, hunkId: number) => {
  const workspace = resolveKnownWorkspace(repository);
  return gitApplyHunk(workspace, resolveGitPath(workspace, filePath), hunkId, true);
});
handleIpc('approval:get-pending', (_event, sessionId?: string) => getPendingApprovals(sessionId));
handleIpc('approval:approve', (_event, approvalId: string) => approveCommand(approvalId));
handleIpc('approval:reject', (_event, approvalId: string) => rejectCommand(approvalId));
handleIpc('settings:get', () => appSettings);
handleIpc('secrets:list', () => secretsStatus());
handleIpc('secrets:upsert', (_event, input: SecretInput) => upsertSecret(input));
handleIpc('secrets:remove', (_event, id: string) => removeSecret(id));
handleIpc('system:startup-checks', () => runStartupChecks());
handleIpc('system:check-updates', () => checkForAppUpdate());
handleIpc('system:check-providers', async () => (await providerReadiness()).checks);
handleIpc('settings:update', (_event, nextSettings: Partial<AppSettings>) => {
  appSettings = {
    defaultProvider: normalizeProvider(nextSettings.defaultProvider),
    ollama: {
      baseUrl: nextSettings.ollama?.baseUrl?.trim() || appSettings.ollama.baseUrl,
      model: nextSettings.ollama?.model?.trim() || appSettings.ollama.model,
      apiKey: nextSettings.ollama?.apiKey?.trim() || appSettings.ollama.apiKey,
    },
    remoteLlamaCpp: {
      baseUrl: nextSettings.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl,
      model: nextSettings.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model,
      apiKey: nextSettings.remoteLlamaCpp?.apiKey?.trim() || appSettings.remoteLlamaCpp.apiKey,
    },
    lanProviders: nextSettings.lanProviders ?? appSettings.lanProviders,
    defaultModel: nextSettings.defaultModel?.trim() || appSettings.defaultModel,
    localProviderBehavior: {
      isolateProfile: nextSettings.localProviderBehavior?.isolateProfile !== false,
      enableWebSearch: nextSettings.localProviderBehavior?.enableWebSearch !== false,
      enableMultiAgent: nextSettings.localProviderBehavior?.enableMultiAgent === true,
    },
  };
  saveSettings();
  mainWindow?.webContents.send('settings:changed', appSettings);
  return appSettings;
});

handleIpc('models:fetch', (_event, config: { baseUrl: string; apiKey?: string }) =>
  fetchModels(config.baseUrl, config.apiKey)
);

handleIpc('lan:add-provider', (_event, provider: LanProvider) => {
  appSettings.lanProviders.push(provider);
  saveSettings();
  mainWindow?.webContents.send('settings:changed', appSettings);
  return appSettings;
});

handleIpc('lan:remove-provider', (_event, id: string) => {
  appSettings.lanProviders = appSettings.lanProviders.filter(p => p.id !== id);
  if (appSettings.defaultProvider === 'lan') {
    appSettings.defaultProvider = 'default';
  }
  saveSettings();
  mainWindow?.webContents.send('settings:changed', appSettings);
  return appSettings;
});

handleIpc('lan:update-provider', (_event, updated: LanProvider) => {
  const idx = appSettings.lanProviders.findIndex(p => p.id === updated.id);
  if (idx >= 0) {
    appSettings.lanProviders[idx] = updated;
    saveSettings();
    mainWindow?.webContents.send('settings:changed', appSettings);
  }
  return appSettings;
});

handleIpc('lan:discover', async () => {
  try {
    return await discoverAndSaveLanProviders();
  } catch (error: unknown) {
    console.error('LAN discovery failed:', error);
    return { found: 0, added: 0, error: String(error), providers: appSettings.lanProviders };
  }
});

handleIpc('ui:copy-text', (_event, text: string) => {
  try {
    if (typeof text !== 'string' || text.length > 5_000_000) return false;
    clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
});
handleIpc('ui:new-session-request', () => {
  mainWindow?.webContents.send('ui:new-session');
  return true;
});
handleIpc('ui:test-remote-llamacpp', (_event, config: { baseUrl: string; apiKey: string; model?: string }) => {
  return testRemoteLlamaCpp(config.baseUrl, config.apiKey, config.model);
});
handleIpc('ui:pick-folder', async () => {
  if (!mainWindow) return null;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose a workspace folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  } catch {
    return null;
  }
});
handleIpc('ui:open-path', async (_event, targetPath: string) => {
  try {
    if (isSafeExternalUrl(targetPath)) {
      await shell.openExternal(targetPath);
      return true;
    }
    const result = await shell.openPath(resolveKnownWorkspace(targetPath));
    return result === '';
  } catch {
    return false;
  }
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.rickenator.consiglio');
    registerRendererProtocol();
    initStore();
    initSettings();
    initSecrets();
    Menu.setApplicationMenu(buildApplicationMenu());
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  for (const id of sessions.keys()) stopSession(id);
  saveWindowState(mainWindow);
  if (process.platform !== 'darwin') app.quit();
});

function buildApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({
      label: 'Consiglio',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  template.push(
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CommandOrControl+N',
          click: () => mainWindow?.webContents.send('ui:new-session'),
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(process.platform === 'darwin'
          ? [{ role: 'pasteAndMatchStyle' as const }, { role: 'delete' as const }]
          : [{ role: 'delete' as const }]),
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
  );
  return Menu.buildFromTemplate(template);
}
