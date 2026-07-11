interface CodexAPI {
  // Sessions
  startSession: (opts: {
    repository?: string;
    branch?: string;
    provider?: 'default' | 'remote_llamacpp';
    remoteLlamaCpp?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
  }) => Promise<{ sessionId: string; pid: number }>;
  stopSession: (sessionId: string) => Promise<boolean>;
  listSessions: () => Promise<any[]>;
  getSessionEvents: (sessionId: string) => Promise<any[]>;
  getTerminalBuffer: (sessionId: string) => Promise<string>;
  sendInput: (sessionId: string, input: string) => Promise<boolean>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  reconnectSession: (sessionId: string) => Promise<boolean>;
  getSettings: () => Promise<{
    defaultProvider: 'default' | 'remote_llamacpp';
    remoteLlamaCpp: {
      baseUrl: string;
      model: string;
      apiKey: string;
    };
  }>;
  updateSettings: (settings: {
    defaultProvider?: 'default' | 'remote_llamacpp';
    remoteLlamaCpp?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
  }) => Promise<{
    defaultProvider: 'default' | 'remote_llamacpp';
    remoteLlamaCpp: {
      baseUrl: string;
      model: string;
      apiKey: string;
    };
  }>;

  // Git
  gitStatus: (repoPath: string) => Promise<any[]>;
  gitDiff: (repoPath: string, filePath: string) => Promise<string>;
  gitBranch: (repoPath: string) => Promise<string>;
  gitDiffHunks: (repoPath: string, filePath: string) => Promise<any[]>;
  gitApplyHunk: (repoPath: string, filePath: string, hunkId: number) => Promise<string>;
  gitRejectHunk: (repoPath: string, filePath: string, hunkId: number) => Promise<string>;

  // Events (streaming)
  onEvent: (callback: (event: any) => void) => () => void;
  onTerminalOutput: (callback: (output: { sessionId: string; data: string }) => void) => () => void;
  onSessionsRecovered: (callback: (sessionIds: string[]) => void) => () => void;

  // Approvals
  getPendingApprovals: (sessionId?: string) => Promise<any[]>;
  approveCommand: (approvalId: string) => Promise<boolean>;
  rejectCommand: (approvalId: string) => Promise<boolean>;
  onApprovalRequest: (callback: (approval: any) => void) => () => void;
  onApprovalProcessed: (callback: (result: { id: string; approved: boolean }) => void) => () => void;
  onNewSession: (callback: () => void) => () => void;
}

interface Window {
  codexApi: CodexAPI;
}
