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
  listSessions: () => Promise<SessionRecord[]>;
  getSessionEvents: (sessionId: string) => Promise<CodexEvent[]>;
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
  gitStatus: (repoPath: string) => Promise<GitStatusEntry[]>;
  gitDiff: (repoPath: string, filePath: string) => Promise<string>;
  gitBranch: (repoPath: string) => Promise<string>;
  gitDiffHunks: (repoPath: string, filePath: string) => Promise<GitHunk[]>;
  gitApplyHunk: (repoPath: string, filePath: string, hunkId: number) => Promise<string>;
  gitRejectHunk: (repoPath: string, filePath: string, hunkId: number) => Promise<string>;

  // Events (streaming)
  onEvent: (callback: (event: CodexEvent) => void) => () => void;
  onTerminalOutput: (callback: (output: { sessionId: string; data: string }) => void) => () => void;
  onSessionsRecovered: (callback: (sessionIds: string[]) => void) => () => void;
  onSessionsUpdated: (callback: (sessions: SessionRecord[]) => void) => () => void;

  // Approvals
  getPendingApprovals: (sessionId?: string) => Promise<ApprovalRecord[]>;
  approveCommand: (approvalId: string) => Promise<boolean>;
  rejectCommand: (approvalId: string) => Promise<boolean>;
  onApprovalRequest: (callback: (approval: ApprovalRecord) => void) => () => void;
  onApprovalProcessed: (callback: (result: { id: string; approved: boolean }) => void) => () => void;
  onNewSession: (callback: () => void) => () => void;
  copyText: (text: string) => Promise<boolean>;
  testRemoteLlamaCpp: (config: { baseUrl: string; apiKey: string; model?: string }) => Promise<{ ok: boolean; message: string; models?: string[] }>;
  pickFolder: () => Promise<string | null>;
  openPath: (targetPath: string) => Promise<boolean>;
}

interface SessionRecord {
  id: string;
  repository: string;
  branch: string;
  provider?: 'default' | 'remote_llamacpp';
  model?: string;
  baseUrl?: string;
  status: 'running' | 'stopped' | 'failed' | 'completed';
  created_at: number;
  updated_at: number;
}

interface CodexEvent {
  id: string;
  session_id: string;
  type: string;
  content: string;
  timestamp: number;
}

interface ApprovalRecord {
  id: string;
  sessionId: string;
  command: string;
  workingDir: string;
  sandboxPolicy: string;
  affectedPaths: string[];
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

interface GitStatusEntry {
  x: string;
  y: string;
  path: string;
}

interface GitHunk {
  id: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  content: string;
}

interface Window {
  codexApi: CodexAPI;
}
