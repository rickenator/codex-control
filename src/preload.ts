import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codexApi', {
  // Sessions
  startSession: (opts: {
    repository?: string;
    branch?: string;
    provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
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
    selectedLanProviderId?: string;
    lanProvider?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
    defaultModel?: string;
  }) =>
    ipcRenderer.invoke('session:start', opts),
  stopSession: (sessionId: string) =>
    ipcRenderer.invoke('session:stop', sessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke('session:delete', sessionId),
  listSessions: () =>
    ipcRenderer.invoke('session:list'),
  getSessionEvents: (sessionId: string) =>
    ipcRenderer.invoke('session:events', sessionId),
  getTerminalBuffer: (sessionId: string) =>
    ipcRenderer.invoke('session:terminal-buffer', sessionId),
  sendInput: (sessionId: string, input: string) =>
    ipcRenderer.invoke('session:send-input', { sessionId, input }),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('session:resize', { sessionId, cols, rows }),
  reconnectSession: (sessionId: string) =>
    ipcRenderer.invoke('session:reconnect', sessionId),
  getSettings: () =>
    ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: {
    defaultProvider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
    ollama?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
    remoteLlamaCpp?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
    defaultModel?: string;
    lanProviders?: Array<{
      id: string;
      name: string;
      host: string;
      port: number;
      model: string;
      apiKey: string;
    }>;
  }) =>
    ipcRenderer.invoke('settings:update', settings),

  // Git
  gitStatus: (repoPath: string) =>
    ipcRenderer.invoke('git:status', repoPath),
  gitDiff: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:diff', repoPath, filePath),
  gitBranch: (repoPath: string) =>
    ipcRenderer.invoke('git:branch', repoPath),


  // Git hunks
  gitDiffHunks: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('git:hunks', repoPath, filePath),
  gitApplyHunk: (repoPath: string, filePath: string, hunkId: number) =>
    ipcRenderer.invoke('git:apply-hunk', repoPath, filePath, hunkId),
  gitRejectHunk: (repoPath: string, filePath: string, hunkId: number) =>
    ipcRenderer.invoke('git:reject-hunk', repoPath, filePath, hunkId),
  // Events (streaming)
  onEvent: (callback: (event: CodexEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CodexEvent) => callback(data);
    ipcRenderer.on('codex:event', handler);
    return () => ipcRenderer.removeListener('codex:event', handler);
  },
  onTerminalOutput: (callback: (output: { sessionId: string; data: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, output: { sessionId: string; data: string }) => callback(output);
    ipcRenderer.on('codex:terminal-output', handler);
    return () => ipcRenderer.removeListener('codex:terminal-output', handler);
  },

  // Session recovery notifications
  onSessionsRecovered: (callback: (sessionIds: string[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionIds: string[]) => callback(sessionIds);
    ipcRenderer.on('codex:sessions-recovered', handler);
    return () => ipcRenderer.removeListener('codex:sessions-recovered', handler);
  },
  onSessionsUpdated: (callback: (sessions: SessionRecord[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessions: SessionRecord[]) => callback(sessions);
    ipcRenderer.on('codex:sessions-updated', handler);
    return () => ipcRenderer.removeListener('codex:sessions-updated', handler);
  },

  // Approvals
  getPendingApprovals: (sessionId?: string) =>
    ipcRenderer.invoke('approval:get-pending', sessionId),
  approveCommand: (approvalId: string) =>
    ipcRenderer.invoke('approval:approve', approvalId),
  rejectCommand: (approvalId: string) =>
    ipcRenderer.invoke('approval:reject', approvalId),

  // Approval notifications
  onApprovalRequest: (callback: (approval: ApprovalRecord) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ApprovalRecord) => callback(data);
    ipcRenderer.on('codex:approval-request', handler);
    return () => ipcRenderer.removeListener('codex:approval-request', handler);
  },
  onApprovalProcessed: (callback: (result: { id: string; approved: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { id: string; approved: boolean }) => callback(data);
    ipcRenderer.on('codex:approval-processed', handler);
    return () => ipcRenderer.removeListener('codex:approval-processed', handler);
  },
  onNewSession: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('ui:new-session', handler);
    return () => ipcRenderer.removeListener('ui:new-session', handler);
  },
  onSettingsChanged: (callback: (settings: CodexSettings) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CodexSettings) => callback(data);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  lanAddProvider: (provider: { id: string; name: string; host: string; port: number; model: string; apiKey: string }) =>
    ipcRenderer.invoke('lan:add-provider', provider),
  lanRemoveProvider: (id: string) =>
    ipcRenderer.invoke('lan:remove-provider', id),
  lanUpdateProvider: (provider: { id: string; name: string; host: string; port: number; model: string; apiKey: string }) =>
    ipcRenderer.invoke('lan:update-provider', provider),
  lanDiscover: () =>
    ipcRenderer.invoke('lan:discover'),

  copyText: (text: string) =>
    ipcRenderer.invoke('ui:copy-text', text),
  requestNewSession: () =>
    ipcRenderer.invoke('ui:new-session-request'),
  fetchModels: (config: { baseUrl: string; apiKey?: string }) =>
    ipcRenderer.invoke('models:fetch', config),

  testRemoteLlamaCpp: (config: { baseUrl: string; apiKey: string; model?: string }) =>
    ipcRenderer.invoke('ui:test-remote-llamacpp', config),
  pickFolder: () =>
    ipcRenderer.invoke('ui:pick-folder'),
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('ui:open-path', targetPath),

  // Startup health and updates
  getStartupStatus: () =>
    ipcRenderer.invoke('system:startup-checks'),
  checkForUpdates: () =>
    ipcRenderer.invoke('system:check-updates'),
  checkProviders: () =>
    ipcRenderer.invoke('system:check-providers'),
});
