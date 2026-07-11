import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

const pty: any = require('node-pty');

type SessionStatus = 'running' | 'stopped' | 'failed' | 'completed';

interface SessionState {
  id: string;
  pty: any;
  repository: string;
  branch: string;
  status: SessionStatus;
  terminalBuffer: string;
}

interface SessionOptions {
  repository?: string;
  branch?: string;
  codexPath?: string;
  provider?: 'default' | 'remote_llamacpp';
  remoteLlamaCpp?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
}

interface SessionRecord {
  id: string;
  repository: string;
  branch: string;
  provider?: 'default' | 'remote_llamacpp';
  model?: string;
  baseUrl?: string;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
}

interface AppSettings {
  defaultProvider: 'default' | 'remote_llamacpp';
  remoteLlamaCpp: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
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
let appSettings: AppSettings = {
  defaultProvider: 'remote_llamacpp',
  remoteLlamaCpp: {
    baseUrl: 'http://192.168.1.240:8081',
    model: 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL',
    apiKey: 'llama.cpp',
  },
};
const sessions = new Map<string, SessionState>();
const records = new Map<string, SessionRecord>();
const events = new Map<string, CodexEvent[]>();
const approvals = new Map<string, ApprovalRequest>();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Codex Control',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
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

function initStore() {
  storePath = path.join(app.getPath('userData'), 'codex-control-sessions.json');
  try {
    const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    for (const record of saved.sessions || []) {
      records.set(record.id, record);
    }
    for (const [sessionId, savedEvents] of Object.entries(saved.events || {})) {
      events.set(sessionId, savedEvents as CodexEvent[]);
    }
    for (const approval of saved.approvals || []) {
      approvals.set(approval.id, approval);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') console.error('Could not read saved sessions:', error);
  }
  for (const record of records.values()) {
    if (record.status === 'running') record.status = 'stopped';
  }
  saveStore();
}

function initSettings() {
  settingsPath = path.join(app.getPath('userData'), 'codex-control-settings.json');
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<AppSettings>;
    appSettings = {
      defaultProvider: saved.defaultProvider === 'default' ? 'default' : 'remote_llamacpp',
      remoteLlamaCpp: {
        baseUrl: saved.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl,
        model: saved.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model,
        apiKey: saved.remoteLlamaCpp?.apiKey?.trim() || appSettings.remoteLlamaCpp.apiKey,
      },
    };
  } catch (error: any) {
    if (error.code !== 'ENOENT') console.error('Could not read settings:', error);
  }
  saveSettings();
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
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.().trim?.();
    return stderr || error.message || 'Failed to apply hunk';
  }
}

function startSession(options: SessionOptions) {
  const repository = path.resolve(options.repository || process.cwd());
  if (!fs.statSync(repository).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${repository}`);
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const branch = options.branch || getBranch(repository);
  const codexPath = options.codexPath || process.env.CODEX_BIN || 'codex';
  const args = ['--no-alt-screen', '-C', repository];
  const env = { ...process.env };
  const provider = options.provider || appSettings.defaultProvider;
  const resolvedRemote = {
    baseUrl: options.remoteLlamaCpp?.baseUrl?.trim() || appSettings.remoteLlamaCpp.baseUrl,
    model: options.remoteLlamaCpp?.model?.trim() || appSettings.remoteLlamaCpp.model,
    apiKey: options.remoteLlamaCpp?.apiKey?.trim() || appSettings.remoteLlamaCpp.apiKey,
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
  recordEvent(sessionId, 'system', `Started Codex in ${repository}`);

  terminal.onData((data: string) => terminalOutput(sessionId, data));
  terminal.onExit(({ exitCode }: { exitCode: number }) => {
    state.status = exitCode === 0 ? 'completed' : 'failed';
    const record = records.get(sessionId);
    if (record) { record.status = state.status; record.updated_at = Date.now(); }
    saveStore();
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
ipcMain.handle('session:reconnect', () => false);

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
  };
  saveSettings();
  return appSettings;
});

app.whenReady().then(() => {
  initStore();
  initSettings();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const id of sessions.keys()) stopSession(id);
  if (process.platform !== 'darwin') app.quit();
});
