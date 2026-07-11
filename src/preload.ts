import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codexApi', {
  // Sessions
  startSession: (opts: { repository?: string; branch?: string; provider?: string }) =>
    ipcRenderer.invoke('session:start', opts),
  stopSession: (sessionId: string) =>
    ipcRenderer.invoke('session:stop', sessionId),
  listSessions: () =>
    ipcRenderer.invoke('session:list'),

  // Git
  gitStatus: (repoPath: string) =>
    ipcRenderer.invoke('git:status', repoPath),
  gitDiff: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:diff', repoPath, filePath),
  gitBranch: (repoPath: string) =>
    ipcRenderer.invoke('git:branch', repoPath),

  // Events (streaming)
  onEvent: (callback: (event: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('codex:event', handler);
    return () => ipcRenderer.removeListener('codex:event', handler);
  },

  // Approvals
  approveCommand: (approvalId: string) =>
    ipcRenderer.invoke('approval:approve', approvalId),
  rejectCommand: (approvalId: string) =>
    ipcRenderer.invoke('approval:reject', approvalId),
});
