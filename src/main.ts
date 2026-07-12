import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import type { IPty } from 'node-pty';

const pty = require('node-pty') as typeof import('node-pty');

type SessionStatus = 'running' | 'stopped' | 'failed' | 'completed';

interface SessionState {
  id: string;
  pty: IPty;
  repository: string;
  branch: string;
  status: SessionStatus;
  terminalBuffer: string;
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
  provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan';
  selectedLanProviderId?: string;
  remoteLlamaCpp?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  lanProvider?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
}

interface SessionRecord {
  id: string;
  repository: string;
  branch: string;
  provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan';
  model?: string;
  baseUrl?: string;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
}

interface AppSettings {
  defaultProvider: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan';
  remoteLlamaCpp: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  lanProviders: LanProvider[];
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

let mainWindow: BrowserWindow | null = null;
let storePath = '';
let settingsPath = '';
let windowStatePath = '';
let appSettings: AppSettings = {
  defaultProvider: 'remote_llamacpp',
  remoteLlamaCpp: {
    baseUrl: 'http://192.168.1.240:8081',
    model: 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL',
    apiKey: 'llama.cpp',
  },
  lanProviders: [],
};
const sessions = new Map<string, SessionState>();
const records = new Map<string, SessionRecord>();
const events = new Map<string, CodexEvent[]>();
const approvals = new Map<string, ApprovalRequest>();

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
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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

function saveSettings() {
  if (!settingsPath) return;
  writeJsonAtomic(settingsPath, appSettings);
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
    if (record.status === 'running') record.status = 'stopped';
  }
  saveStore();
}

function initSettings() {
  settingsPath = path.join(app.getPath('userData'), 'consiglio-settings.json');
  const saved = readJsonWithFallback<Partial<AppSettings>>([
    settingsPath,
    path.join(app.getPath('userData'), 'consiglier-settings.json'),
    path.join(app.getPath('userData'), 'codex-control-settings.json'),
  ]);
  try {
    if (saved) {
      appSettings = {
        defaultProvider: saved.defaultProvider === 'default' ? 'default' : 'remote_llamacpp',
        remoteLlamaCpp: {
          baseUrl: saved.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl,
          model: saved.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model,
          apiKey: saved.remoteLlamaCpp?.apiKey?.trim() || appSettings.remoteLlamaCpp.apiKey,
        },
        lanProviders: Array.isArray(saved.lanProviders) ? saved.lanProviders : [],
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
  return event;
}

function terminalOutput(sessionId: string, data: string) {
  const state = sessions.get(sessionId);
  if (state) state.terminalBuffer = (state.terminalBuffer + data).slice(-1_000_000);
  mainWindow?.webContents.send('codex:terminal-output', { sessionId, data });
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
  const repository = path.resolve(options.repository || process.cwd());
  if (!fs.statSync(repository).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${repository}`);
  }
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return launchSession(sessionId, repository, options.branch || getBranch(repository), provider, options, false);
}

function launchSession(
  sessionId: string,
  repository: string,
  branch: string,
  provider: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan',
  options: SessionOptions,
  isReconnect: boolean,
) {
  const codexPath = options.codexPath || process.env.CODEX_BIN || 'codex';
  const args = ['--no-alt-screen', '-C', repository];
  const env = { ...process.env };
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
  if (provider === 'gpt56') {
    args.push('-m', 'gpt-5.6');
  }
  if (provider === 'lan') {
    const lanProvider = getLanProvider(options.selectedLanProviderId);
    if (!lanProvider) throw new Error('No LAN provider configured');

    const normalizedBaseUrl = normalizeBaseUrl(`${lanProvider.host}:${lanProvider.port}`);
    const apiKey = lanProvider.apiKey || 'llama.cpp';

    env.OPENAI_BASE_URL = normalizedBaseUrl;
    env.OPENAI_API_BASE = normalizedBaseUrl;
    env.OPENAI_API_KEY = apiKey;
    env.OPENAI_MODEL = lanProvider.model;
    env.CODEX_OSS_BASE_URL = normalizedBaseUrl;

    args.push(
      '-c', `model=${quoteTomlString(lanProvider.model)}`,
      '-c', 'model_provider="lan"',
      '-c', 'model_providers.lan.name=lan',
      '-c', `model_providers.lan.base_url=${quoteTomlString(normalizedBaseUrl)}`,
      '-c', 'model_providers.lan.wire_api="responses"',
      '-c', 'model_providers.lan.env_key="OPENAI_API_KEY"',
    );

    records.set(sessionId, {
      id: sessionId, repository, branch, provider,
      model: lanProvider.model,
      baseUrl: normalizedBaseUrl,
      status: 'running', created_at: Date.now(), updated_at: Date.now(),
    });
  }

  const terminal = pty.spawn(codexPath, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 36,
    cwd: repository,
    env,
  });
  const state: SessionState = { id: sessionId, pty: terminal, repository, branch, status: 'running', terminalBuffer: '' };
  sessions.set(sessionId, state);
  records.set(sessionId, {
    id: sessionId,
    repository,
    branch,
    provider,
    model: provider === 'remote_llamacpp' ? resolvedRemote.model : undefined,
    baseUrl: provider === 'remote_llamacpp' ? normalizeBaseUrl(resolvedRemote.baseUrl) : undefined,
    status: 'running',
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  saveStore();
  emitSessionUpdate();
  recordEvent(sessionId, 'system', `${isReconnect ? 'Reconnected' : 'Started'} Codex in ${repository}`);

  terminal.onData((data: string) => terminalOutput(sessionId, data));
  terminal.onExit(({ exitCode }: { exitCode: number }) => {
    state.status = exitCode === 0 ? 'completed' : 'failed';
    const record = records.get(sessionId);
    if (record) { record.status = state.status; record.updated_at = Date.now(); }
    saveStore();
    emitSessionUpdate();
    recordEvent(sessionId, 'system', `Codex exited with code ${exitCode}`);
    sessions.delete(sessionId);
  });
  return { sessionId, pid: terminal.pid, repository, branch };
}

function stopSession(sessionId: string) {
  const state = sessions.get(sessionId);
  if (!state) return false;
  state.pty.kill();
  sessions.delete(sessionId);
  const record = records.get(sessionId);
  if (record) { record.status = 'stopped'; record.updated_at = Date.now(); }
  saveStore();
  emitSessionUpdate();
  return true;
}

ipcMain.handle('session:start', (_event, options: SessionOptions) => startSession(options || {}));
ipcMain.handle('session:stop', (_event, sessionId: string) => stopSession(sessionId));
ipcMain.handle('session:list', () => [...records.values()].sort((left, right) => right.updated_at - left.updated_at));
ipcMain.handle('session:events', (_event, sessionId: string) => events.get(sessionId) || []);
ipcMain.handle('session:terminal-buffer', (_event, sessionId: string) => sessions.get(sessionId)?.terminalBuffer || '');
ipcMain.handle('session:send-input', (_event, { sessionId, input }: { sessionId: string; input: string }) => {
  const state = sessions.get(sessionId);
  if (!state || !input) return false;
  state.pty.write(input);
  return true;
});
ipcMain.handle('session:resize', (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
  const state = sessions.get(sessionId);
  if (!state) return false;
  state.pty.resize(Math.max(2, cols), Math.max(2, rows));
  return true;
});
ipcMain.handle('session:reconnect', (_event, sessionId: string) => {
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
  }, true);
  const updated = records.get(sessionId);
  if (updated) {
    updated.status = 'running';
    updated.updated_at = Date.now();
    records.set(sessionId, updated);
    saveStore();
  }
  emitSessionUpdate();
  return true;
});

ipcMain.handle('git:status', (_event, repository: string) => gitStatus(repository));
ipcMain.handle('git:diff', (_event, repository: string, filePath: string) => gitDiff(repository, filePath));
ipcMain.handle('git:branch', (_event, repository: string) => getBranch(repository));
ipcMain.handle('git:hunks', (_event, repository: string, filePath: string) => gitHunks(repository, filePath));
ipcMain.handle('git:apply-hunk', (_event, repository: string, filePath: string, hunkId: number) => gitApplyHunk(repository, filePath, hunkId, false));
ipcMain.handle('git:reject-hunk', (_event, repository: string, filePath: string, hunkId: number) => gitApplyHunk(repository, filePath, hunkId, true));
ipcMain.handle('approval:get-pending', (_event, sessionId?: string) => getPendingApprovals(sessionId));
ipcMain.handle('approval:approve', (_event, approvalId: string) => approveCommand(approvalId));
ipcMain.handle('approval:reject', (_event, approvalId: string) => rejectCommand(approvalId));
ipcMain.handle('settings:get', () => appSettings);
ipcMain.handle('settings:update', (_event, nextSettings: Partial<AppSettings>) => {
  appSettings = {
    defaultProvider: nextSettings.defaultProvider === 'default' ? 'default' : 'remote_llamacpp',
    remoteLlamaCpp: {
      baseUrl: nextSettings.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl,
      model: nextSettings.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model,
      apiKey: nextSettings.remoteLlamaCpp?.apiKey?.trim() || appSettings.remoteLlamaCpp.apiKey,
    },
    lanProviders: nextSettings.lanProviders ?? appSettings.lanProviders,
  };
  saveSettings();
  return appSettings;
});

ipcMain.handle('models:fetch', (_event, config: { baseUrl: string; apiKey?: string }) =>
  fetchModels(config.baseUrl, config.apiKey)
);

ipcMain.handle('lan:add-provider', (_event, provider: LanProvider) => {
  appSettings.lanProviders.push(provider);
  saveSettings();
  return appSettings;
});

ipcMain.handle('lan:remove-provider', (_event, id: string) => {
  appSettings.lanProviders = appSettings.lanProviders.filter(p => p.id !== id);
  if (appSettings.defaultProvider === 'lan') {
    appSettings.defaultProvider = 'remote_llamacpp';
  }
  saveSettings();
  return appSettings;
});

ipcMain.handle('lan:update-provider', (_event, updated: LanProvider) => {
  const idx = appSettings.lanProviders.findIndex(p => p.id === updated.id);
  if (idx >= 0) {
    appSettings.lanProviders[idx] = updated;
    saveSettings();
  }
  return appSettings;
});

ipcMain.handle('ui:copy-text', (_event, text: string) => {
  try {
    clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('ui:new-session-request', () => {
  mainWindow?.webContents.send('ui:new-session');
  return true;
});
ipcMain.handle('ui:test-remote-llamacpp', (_event, config: { baseUrl: string; apiKey: string; model?: string }) => {
  return testRemoteLlamaCpp(config.baseUrl, config.apiKey, config.model);
});
ipcMain.handle('ui:pick-folder', async () => {
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
ipcMain.handle('ui:open-path', async (_event, targetPath: string) => {
  try {
    const result = await shell.openPath(targetPath);
    return result === '';
  } catch {
    return false;
  }
});

app.whenReady().then(() => {
  initStore();
  initSettings();
  Menu.setApplicationMenu(buildApplicationMenu());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const id of sessions.keys()) stopSession(id);
  saveWindowState(mainWindow);
  if (process.platform !== 'darwin') app.quit();
});

function buildApplicationMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CommandOrControl+N',
          click: () => mainWindow?.webContents.send('ui:new-session'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
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
  ]);
}
