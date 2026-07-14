type CodexProvider = 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';

interface LanProviderConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
}

interface CodexSettings {
  defaultProvider: CodexProvider;
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
  lanProviders: LanProviderConfig[];
  defaultModel?: string;
  localProviderBehavior: {
    isolateProfile: boolean;
    enableWebSearch: boolean;
    enableMultiAgent: boolean;
  };
}

interface CodexSettingsInput {
  defaultProvider?: CodexProvider;
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
  lanProviders?: LanProviderConfig[];
  defaultModel?: string;
  localProviderBehavior?: Partial<CodexSettings['localProviderBehavior']>;
}

type SecretScope = 'all' | 'codex' | 'local';

interface SecretMetadata {
  id: string;
  label: string;
  envVar: string;
  scope: SecretScope;
  enabled: boolean;
  hasValue: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SecretsStatus {
  available: boolean;
  backend: string;
  secure: boolean;
  secrets: SecretMetadata[];
}

interface SecretInput {
  id?: string;
  label: string;
  envVar: string;
  value?: string;
  scope: SecretScope;
  enabled: boolean;
}

interface TaskAttachment {
  name: string;
  path: string;
  size: number;
  kind: 'image' | 'pdf' | 'text' | 'file';
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
  providerSetup: {
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
  };
}

interface CodexAPI {
  // Sessions
  startSession: (opts: {
    repository?: string;
    branch?: string;
    provider?: CodexProvider;
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
  }) => Promise<{ sessionId: string; pid: number }>;
  stopSession: (sessionId: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  listSessions: () => Promise<SessionRecord[]>;
  getSessionEvents: (sessionId: string) => Promise<CodexEvent[]>;
  getTerminalBuffer: (sessionId: string) => Promise<string>;
  sendInput: (sessionId: string, input: string) => Promise<boolean>;
  listWorkspaceFiles: (sessionId: string, path?: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean; isImage: boolean }>>;
  readWorkspaceFile: (sessionId: string, path: string) => Promise<{ kind: 'image'; path: string; dataUrl: string } | { kind: 'text'; path: string; text: string }>;
  addSessionAttachments: (sessionId: string) => Promise<TaskAttachment[]>;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  reconnectSession: (sessionId: string) => Promise<boolean>;
  getSettings: () => Promise<CodexSettings>;
  updateSettings: (settings: CodexSettingsInput) => Promise<CodexSettings>;
  listSecrets: () => Promise<SecretsStatus>;
  upsertSecret: (secret: SecretInput) => Promise<SecretsStatus>;
  removeSecret: (id: string) => Promise<SecretsStatus>;

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
  onSettingsChanged: (callback: (settings: CodexSettings) => void) => () => void;
  copyText: (text: string) => Promise<boolean>;
  requestNewSession: () => Promise<boolean>;
  fetchModels: (config: { baseUrl: string; apiKey?: string }) => Promise<Array<{ id: string; name?: string }>>;
  testRemoteLlamaCpp: (config: { baseUrl: string; apiKey: string; model?: string }) => Promise<{ ok: boolean; message: string; models?: string[] }>;
  pickFolder: () => Promise<string | null>;
  openPath: (targetPath: string) => Promise<boolean>;
  getStartupStatus: () => Promise<StartupStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  checkProviders: () => Promise<HealthCheckItem[]>;
  lanAddProvider: (provider: { id: string; name: string; host: string; port: number; model: string; apiKey: string }) => Promise<CodexSettings>;
  lanRemoveProvider: (id: string) => Promise<CodexSettings>;
  lanUpdateProvider: (provider: { id: string; name: string; host: string; port: number; model: string; apiKey: string }) => Promise<CodexSettings>;
  lanDiscover: () => Promise<{ found: number; added: number; error?: string; providers: LanProviderConfig[] }>;
}

interface SessionRecord {
  id: string;
  repository: string;
  branch: string;
  provider?: CodexProvider;
  model?: string;
  baseUrl?: string;
  selectedLanProviderId?: string;
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
