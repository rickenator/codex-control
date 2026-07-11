import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
import * as Database from 'better-sqlite3';

// Load native C++ addon
const codexAddon = require('../native/build/Release/codex.node');

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

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

// ─── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('session:start', async (_event, { repository, branch, provider }) => {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (db) {
    db.prepare(`INSERT INTO sessions (id, repository, branch, status) VALUES (?, ?, ?, 'running')`).run(
      sessionId, repository, branch || ''
    );
  }

  // TODO: Launch Codex CLI or connect to app-server
  return { sessionId };
});

ipcMain.handle('session:stop', async (_event, sessionId) => {
  if (db) {
    db.prepare(`UPDATE sessions SET status = 'stopped', updated_at = ? WHERE id = ?`).run(
      Date.now(), sessionId
    );
  }
  return true;
});

ipcMain.handle('session:list', async () => {
  if (!db) return [];
  return db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
