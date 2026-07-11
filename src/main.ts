import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as Database from 'better-sqlite3';

// Load native C++ addon
const codexAddon = require('../native/build/Release/codex.node');

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

// Session state
interface SessionState {
  id: string;
  process: ChildProcess | null;
  repository?: string;
  branch?: string;
  status: 'idle' | 'running' | 'awaiting_approval' | 'paused' | 'failed' | 'completed';
  events: any[];
}

const sessions: Map<string, SessionState> = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Codex Control',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'codex-control.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      repository TEXT,
      branch TEXT,
      status TEXT DEFAULT 'idle',
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      event_type TEXT,
      timestamp INTEGER,
      payload TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      command TEXT,
      working_dir TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      base_url TEXT,
      api_key_ref TEXT,
      model TEXT,
      is_active INTEGER DEFAULT 0
    );
  `);
}

// ─── Codex session management ───────────────────────────────────────────────

function startCodexSession(sessionId: string, opts: {
  codexPath?: string;
  repoPath?: string;
  branch?: string;
  provider?: string;
}): { sessionId: string; pid: number } {
  const codexPath = opts.codexPath || 'codex';
  const repoPath = opts.repoPath || process.cwd();

  // Use native addon to spawn process
  const result = codexAddon.startSession(sessionId, {
    codexPath,
    repoPath,
  });

  // Create session state
  const sessionState: SessionState = {
    id: sessionId,
    process: null,
    repository: opts.repoPath,
    branch: opts.branch,
    status: 'running',
    events: [],
  };

  sessions.set(sessionId, sessionState);

  // Update database
  if (db) {
    db.prepare(`INSERT OR REPLACE INTO sessions (id, repository, branch, status) VALUES (?, ?, ?, ?)`).run(
      sessionId,
      opts.repoPath || '',
      opts.branch || '',
      'running'
    );
  }

  return result;
}

function stopCodexSession(sessionId: string): boolean {
  codexAddon.stopSession(sessionId);
  sessions.delete(sessionId);

  if (db) {
    db.prepare(`UPDATE sessions SET status = 'stopped', updated_at = ? WHERE id = ?`).run(
      Date.now(), sessionId
    );
  }

  return true;
}

// ─── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('session:start', async (_event, opts) => {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return startCodexSession(sessionId, opts);
});

ipcMain.handle('session:stop', async (_event, sessionId) => {
  return stopCodexSession(sessionId);
});

ipcMain.handle('session:list', async () => {
  if (!db) return [];
  return db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all();
});

ipcMain.handle('session:events', (_event, sessionId: string) => {
  const session = sessions.get(sessionId);
  return session?.events || [];
});

ipcMain.handle('session:send-input', (_event, { sessionId, input }: { sessionId: string; input: string }) => {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Send input to the Codex process
  if (session.process) {
    session.process.stdin?.write(input + '\n');
  } else {
    codexAddon.sendInput(sessionId, input);
  }

  // Record event
  const event = {
    id: `evt_${Date.now()}`,
    type: 'prompt',
    content: input,
    timestamp: Date.now(),
    session_id: sessionId,
  };

  session.events.push(event);

  // Persist to database
  if (db) {
    db.prepare(`INSERT INTO events (id, session_id, event_type, timestamp, payload) VALUES (?, ?, ?, ?, ?)`).run(
      event.id,
      sessionId,
      event.type,
      event.timestamp,
      JSON.stringify(event)
    );
  }

  // Emit event to renderer
  mainWindow?.webContents.send('codex:event', event);

  return true;
});

ipcMain.handle('git:status', (_event, repoPath: string) => {
  try {
    return codexAddon.gitStatus(repoPath);
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('git:diff', (_event, repoPath: string, filePath: string) => {
  try {
    return codexAddon.gitDiff(repoPath, filePath);
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('git:branch', (_event, repoPath: string) => {
  try {
    return codexAddon.gitBranch(repoPath);
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('approval:approve', (_event, approvalId: string) => {
  // TODO: Implement approval logic
  console.log('Approval approved:', approvalId);
  return true;
});

ipcMain.handle('approval:reject', (_event, approvalId: string) => {
  // TODO: Implement rejection logic
  console.log('Approval rejected:', approvalId);
  return true;
});

// ─── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  db?.close();
  // Stop all sessions
  for (const [id] of sessions) {
    stopCodexSession(id);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
