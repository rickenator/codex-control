import { useEffect, useMemo, useRef, useState } from 'react';

interface Session {
  id: string;
  repository?: string;
  branch?: string;
  status: string;
  updated_at: number;
  provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
  model?: string;
}

type Provider = 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';

type NewSessionOptions = {
  repository?: string;
  branch?: string;
  provider?: Provider;
  remoteLlamaCpp?: { baseUrl?: string; model?: string; apiKey?: string };
  ollama?: { baseUrl?: string; model?: string; apiKey?: string };
  selectedLanProviderId?: string;
  defaultModel?: string;
};

type LanProviderConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
};

interface Props {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
  onStartSession: (options: NewSessionOptions) => void;
  onReconnect: (sessionId: string) => void;
  onPickRepository: () => Promise<string | null>;
  onCopyPath: (path: string, label: string) => void;
  onOpenPath: (path: string, label: string) => void;
  onTestRemote: (config: { baseUrl: string; model: string; apiKey: string }) => Promise<boolean>;
  onRequestNewSession: () => Promise<void>;
  onStopSession: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  settings: {
    defaultProvider: Provider;
    ollama: { baseUrl: string; model: string; apiKey: string };
    remoteLlamaCpp: { baseUrl: string; model: string; apiKey: string };
    lanProviders: LanProviderConfig[];
    defaultModel?: string;
    localProviderBehavior: {
      isolateProfile: boolean;
      enableWebSearch: boolean;
      enableMultiAgent: boolean;
    };
  };
  connectionLabel: string;
  onSettingsChange: (settings: Props['settings']) => void;
}

export default function SessionList({
  sessions,
  selected,
  onSelect,
  onStartSession,
  onPickRepository,
  onDeleteSession,
  settings,
  connectionLabel,
}: Props) {
  const [showNewTask, setShowNewTask] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [provider, setProvider] = useState<Provider>(settings.defaultProvider);
  const repositoryRef = useRef<HTMLInputElement>(null);

  const sortedSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updated_at - left.updated_at),
    [sessions],
  );

  useEffect(() => {
    const unsubscribe = window.codexApi.onNewSession(() => setShowNewTask(true));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (showNewTask) queueMicrotask(() => repositoryRef.current?.focus());
  }, [showNewTask]);

  useEffect(() => {
    setProvider(settings.defaultProvider);
  }, [settings.defaultProvider]);

  const startTask = async () => {
    const workspace = repository.trim();
    onStartSession({
      repository: workspace || undefined,
      branch: branch.trim() || undefined,
      provider,
      remoteLlamaCpp: provider === 'remote_llamacpp' ? settings.remoteLlamaCpp : undefined,
      ollama: provider === 'ollama' ? settings.ollama : undefined,
      selectedLanProviderId: provider === 'lan' ? settings.lanProviders[0]?.id : undefined,
      defaultModel: provider === 'default' ? settings.defaultModel : undefined,
    });
    setRepository('');
    setBranch('');
    setShowOptions(false);
    setShowNewTask(false);
  };

  return (
    <aside className="codex-sidebar codex-simple-sidebar">
      <div className="codex-sidebar-top">
        <div className="codex-wordmark">Consiglio</div>
        <button className="codex-new-task" onClick={() => void startTask()}>
          <span aria-hidden="true">+</span>
          New task
        </button>
        <button className="codex-open-workspace" onClick={() => setShowNewTask(true)}>
          Open folder…
        </button>
      </div>

      <div className="codex-session-heading">Recent</div>
      <div className="codex-list" aria-label="Sessions">
        {sortedSessions.length === 0 && (
          <div className="codex-sidebar-empty">Open a workspace to start.</div>
        )}
        {sortedSessions.map((session) => {
          const label = sessionLabel(session.repository);
          return (
            <button
              key={session.id}
              className={`codex-simple-session${selected === session.id ? ' is-active' : ''}`}
              onClick={() => onSelect(session.id)}
              title={session.repository || label}
            >
              <span className={`codex-session-dot is-${session.status}`} aria-hidden="true" />
              <span className="codex-simple-session-copy">
                <span className="codex-simple-session-title">{label}</span>
                <span className="codex-simple-session-meta">
                  {session.branch || session.model || providerLabel(session.provider)} · {formatUpdatedAt(session.updated_at)}
                </span>
              </span>
              {(session.status === 'completed' || session.status === 'stopped' || session.status === 'failed') && (
                <span
                  role="button"
                  tabIndex={0}
                  className="codex-session-delete"
                  title="Delete session"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDeleteSession(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.stopPropagation();
                      void onDeleteSession(session.id);
                    }
                  }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="codex-sidebar-provider" title={connectionLabel || providerLabel(settings.defaultProvider)}>
        <span className="codex-session-dot is-running" aria-hidden="true" />
        <span className="codex-sidebar-provider-label">{connectionLabel || providerLabel(settings.defaultProvider)}</span>
      </div>

      {showNewTask && (
        <div className="codex-modal-backdrop" onMouseDown={() => setShowNewTask(false)}>
          <section className="codex-new-task-dialog" onMouseDown={(event) => event.stopPropagation()} aria-label="New task">
            <div className="codex-dialog-header">
              <div>
                <h2>Open folder</h2>
                <p>Optional: give the new task a specific workspace.</p>
              </div>
              <button className="codex-icon-button" onClick={() => setShowNewTask(false)} aria-label="Close">×</button>
            </div>

            <label className="codex-field-label" htmlFor="workspace-path">Workspace (optional)</label>
            <div className="codex-path-picker">
              <input
                id="workspace-path"
                ref={repositoryRef}
                className="codex-input"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder="Select a folder"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void startTask();
                }}
              />
              <button
                className="codex-button codex-button-secondary"
                onClick={async () => {
                  const picked = await onPickRepository();
                  if (picked) setRepository(picked);
                }}
              >
                Browse
              </button>
            </div>

            <button className="codex-options-toggle" onClick={() => setShowOptions((current) => !current)}>
              {showOptions ? 'Hide options' : 'Options'}
            </button>

            {showOptions && (
              <div className="codex-task-options">
                <label className="codex-field-label" htmlFor="task-provider">Provider</label>
                <select id="task-provider" className="codex-select" value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                  <option value="remote_llamacpp">Remote llama.cpp</option>
                  <option value="default">Codex</option>
                  <option value="ollama">Ollama</option>
                  <option value="gpt56">GPT-5.6</option>
                  {settings.lanProviders.length > 0 && <option value="lan">LAN provider</option>}
                </select>
                <label className="codex-field-label" htmlFor="task-branch">Branch override</label>
                <input id="task-branch" className="codex-input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Use current branch" />
              </div>
            )}

            <div className="codex-dialog-actions">
              <button className="codex-button codex-button-secondary" onClick={() => setShowNewTask(false)}>Cancel</button>
              <button className="codex-button codex-button-primary" onClick={() => void startTask()}>Start task</button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}

function sessionLabel(repository?: string) {
  const trimmed = repository?.trim() || '';
  if (!trimmed) return 'Untitled task';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function providerLabel(provider?: Provider) {
  if (provider === 'remote_llamacpp') return 'Remote llama.cpp';
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'gpt56') return 'GPT-5.6';
  if (provider === 'lan') return 'LAN provider';
  return 'Codex';
}

function formatUpdatedAt(updatedAt: number) {
  const minutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
