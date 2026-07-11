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
  lastEventTimestamp: number;
  ptyFd: number;
}

const sessions: Map<string, SessionState> = new Map();

// Approval queue — shared across all sessions
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

const approvalQueue: ApprovalRequest[] = [];

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

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      command TEXT,
      working_dir TEXT,
      sandbox_policy TEXT DEFAULT 'on-request',
      affected_paths TEXT,
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
    lastEventTimestamp: Date.now(),
    ptyFd: result.ptyFd || 0,
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

// ─── Approval management ────────────────────────────────────────────────────

function addApprovalRequest(approval: Omit<ApprovalRequest, 'id' | 'timestamp'>): string {
  const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullApproval: ApprovalRequest = {
    ...approval,
    id,
    timestamp: Date.now(),
    status: 'pending',
  };

  approvalQueue.push(fullApproval);

  // Persist to database
  if (db) {
    db.prepare(`INSERT INTO approvals (id, session_id, command, working_dir, sandbox_policy, affected_paths, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      approval.sessionId,
      approval.command,
      approval.workingDir,
      approval.sandboxPolicy,
      JSON.stringify(approval.affectedPaths),
      'pending'
    );
  }

  // Emit to renderer
  mainWindow?.webContents.send('codex:approval-request', fullApproval);

  return id;
}

function processApproval(approvalId: string, approved: boolean): boolean {
  const approval = approvalQueue.find(a => a.id === approvalId && a.status === 'pending');
  if (!approval) return false;

  approval.status = approved ? 'approved' : 'rejected';

  // Update database
  if (db) {
    db.prepare(`UPDATE approvals SET status = ? WHERE id = ?`).run(
      approval.status, approvalId
    );
  }

  // Emit to renderer
  mainWindow?.webContents.send('codex:approval-processed', { id: approvalId, approved });

  return true;
}

// ─── Session recovery ───────────────────────────────────────────────────────

function recoverSessions() {
  if (!db) return [];

  // Load all sessions from database
  const allSessions = db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all();
  const recovered: string[] = [];

  for (const sessionRow of allSessions as any[]) {
    // Check if the session is still running by querying the native addon
    const isRunning = codexAddon.isSessionRunning(sessionRow.id);

    if (isRunning) {
      // Session is still active — load its events from the database
      const events = db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`).all(sessionRow.id);

      const sessionState: SessionState = {
        id: sessionRow.id,
        process: null,
        repository: sessionRow.repository || undefined,
        branch: sessionRow.branch || undefined,
        status: sessionRow.status as any,
        events: events.map((e: any) => JSON.parse(e.payload)),
        lastEventTimestamp: Date.now(),
        ptyFd: 0,
      };

      sessions.set(sessionRow.id, sessionState);
      recovered.push(sessionRow.id);

      // Emit recovered events to renderer
      for (const event of sessionState.events) {
        mainWindow?.webContents.send('codex:event', event);
      }
    } else {
      // Session is no longer running — mark as failed/stopped
      db.prepare(`UPDATE sessions SET status = 'failed', updated_at = ? WHERE id = ?`).run(
        Date.now(), sessionRow.id
      );
    }
  }

  return recovered;
}

// ─── Event persistence helper ───────────────────────────────────────────────

function persistEvent(sessionId: string, event: any) {
  if (!db) return;

  // Store in SQLite
  db.prepare(`INSERT INTO events (id, session_id, event_type, timestamp, payload) VALUES (?, ?, ?, ?, ?)`).run(
    event.id,
    sessionId,
    event.type,
    event.timestamp,
    JSON.stringify(event)
  );

  // Also append to JSONL log file for crash recovery
  const logPath = path.join(app.getPath('userData'), 'events', `${sessionId}.jsonl`);
  try {
    const fs = require('fs');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
  } catch (e) {
    console.error('Failed to append event log:', e);
  }
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

  // Send input to the Codex process via native addon
  codexAddon.sendInput(sessionId, input);

  // Record event
  const event = {
    id: `evt_${Date.now()}`,
    type: 'prompt',
    content: input,
    timestamp: Date.now(),
    session_id: sessionId,
  };

  session.events.push(event);
  persistEvent(sessionId, event);

  // Emit event to renderer
  mainWindow?.webContents.send('codex:event', event);

  return true;
});

ipcMain.handle('session:reconnect', (_event, sessionId: string) => {
  // Reconnect to a session by replaying its event log
  if (!db) return false;

  const events = db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`).all(sessionId);
  const sessionState: SessionState = {
    id: sessionId,
    process: null,
    repository: '',
    branch: '',
    status: 'running',
    events: events.map((e: any) => JSON.parse(e.payload)),
    lastEventTimestamp: Date.now(),
    ptyFd: 0,
  };

  sessions.set(sessionId, sessionState);

  // Emit recovered events to renderer
  for (const event of sessionState.events) {
    mainWindow?.webContents.send('codex:event', event);
  }

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

ipcMain.handle('approval:get-pending', (_event, sessionId?: string) => {
  // Get pending approvals, optionally filtered by session
  const pending = approvalQueue.filter(a => a.status === 'pending' && (!sessionId || a.sessionId === sessionId));
  return pending;
});

ipcMain.handle('approval:approve', (_event, approvalId: string) => {
  return processApproval(approvalId, true);
});

ipcMain.handle('approval:reject', (_event, approvalId: string) => {
  return processApproval(approvalId, false);
});

// ─── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  // Recover any sessions that were running when the GUI crashed
  const recovered = recoverSessions();
  if (recovered.length > 0) {
    console.log(`Recovered ${recovered.length} session(s):`, recovered);
    mainWindow?.webContents.send('codex:sessions-recovered', recovered);
  }

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
