import React, { useEffect, useState } from 'react';

interface Session {
  id: string;
  repository?: string;
  branch?: string;
  status: string;
  updated_at: number;
}

type NewSessionOptions = {
  repository?: string;
  branch?: string;
  provider?: 'default' | 'remote_llamacpp';
  remoteLlamaCpp?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
};

interface Props {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
  onStartSession: (options: NewSessionOptions) => void;
  onReconnect: (sessionId: string) => void;
  settings: {
    defaultProvider: 'default' | 'remote_llamacpp';
    remoteLlamaCpp: {
      baseUrl: string;
      model: string;
      apiKey: string;
    };
  };
  onSettingsChange: (settings: {
    defaultProvider: 'default' | 'remote_llamacpp';
    remoteLlamaCpp: {
      baseUrl: string;
      model: string;
      apiKey: string;
    };
  }) => void;
}

const statusColor: Record<string, string> = {
  idle: '#8b949e',
  running: '#58a6ff',
  awaiting_approval: '#d29922',
  paused: '#8b949e',
  failed: '#f85149',
  completed: '#3fb950',
  stopped: '#484f58',
};

export default function SessionList({ sessions, selected, onSelect, onStartSession, onReconnect, settings, onSettingsChange }: Props) {
  const [showNewSession, setShowNewSession] = useState(false);
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [provider, setProvider] = useState<'default' | 'remote_llamacpp'>(settings.defaultProvider);
  const [baseUrl, setBaseUrl] = useState(settings.remoteLlamaCpp.baseUrl);
  const [model, setModel] = useState(settings.remoteLlamaCpp.model);
  const [apiKey, setApiKey] = useState(settings.remoteLlamaCpp.apiKey);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setProvider(settings.defaultProvider);
    setBaseUrl(settings.remoteLlamaCpp.baseUrl);
    setModel(settings.remoteLlamaCpp.model);
    setApiKey(settings.remoteLlamaCpp.apiKey);
  }, [settings]);

  useEffect(() => {
    const unsubscribe = window.codexApi.onNewSession(() => {
      setShowNewSession(true);
    });
    return () => unsubscribe();
  }, []);

  const filteredSessions = sessions.filter(session => {
    const haystack = [
      session.repository,
      session.branch,
      session.status,
      session.provider,
      session.model,
      session.baseUrl,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  return (
    <aside className="codex-sidebar">
      <div style={{ padding: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f0f6fc' }}>Sessions</h3>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>Active workspaces and launch profiles</div>
          </div>
          <button
            className="codex-button codex-button-info"
            onClick={() => setShowNewSession(!showNewSession)}
          >
            + New
          </button>
        </div>

        <div className="codex-form-card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600 }}>Default profile</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                {settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp' : 'Default Codex'}
              </span>
            </div>
            <button
              aria-label="Save default launch profile"
              className="codex-button codex-button-primary"
              onClick={() => onSettingsChange({
                defaultProvider: provider,
                remoteLlamaCpp: { baseUrl, model, apiKey },
              })}
            >
              Save profile
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <MiniRow label="Endpoint" value={settings.remoteLlamaCpp.baseUrl} />
            <MiniRow label="Model" value={settings.remoteLlamaCpp.model} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => {
                setProvider('remote_llamacpp');
                setBaseUrl('http://192.168.1.240:8081');
                setModel('Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL');
                setApiKey('llama.cpp');
              }}
            >
              Reset local draft
            </button>
          </div>
        </div>

        {showNewSession && (
          <div className="codex-form-card">
            <input
              type="text"
              placeholder="Repository path"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              className="codex-input"
              style={{ marginBottom: 4 }}
            />
            <input
              type="text"
              placeholder="Branch (optional)"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              className="codex-input"
              style={{ marginBottom: 8 }}
            />
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#8b949e' }}>Provider</label>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'default' | 'remote_llamacpp')}
              className="codex-select"
              style={{ marginBottom: 8 }}
              >
                <option value="remote_llamacpp">Remote llama.cpp</option>
                <option value="default">Default Codex</option>
              </select>
            {provider === 'remote_llamacpp' && (
              <>
                <input
                  type="text"
                  placeholder="llama.cpp base URL"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="codex-input"
                  style={{ marginBottom: 4 }}
                />
                <input
                  type="text"
                  placeholder="Model name"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="codex-input"
                  style={{ marginBottom: 4 }}
                />
                <input
                  type="password"
                  placeholder="API key (optional)"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="codex-input"
                  style={{ marginBottom: 8 }}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className="codex-button codex-button-primary"
                onClick={() => onSettingsChange({
                  defaultProvider: 'remote_llamacpp',
                  remoteLlamaCpp: { baseUrl, model, apiKey },
                })}
              >
                Save as default
              </button>
            </div>
            <button
              className="codex-button codex-button-secondary"
              disabled={provider === 'remote_llamacpp' && (!baseUrl.trim() || !model.trim())}
              onClick={() => {
                onStartSession({
                  repository: repository.trim() || undefined,
                  branch: branch.trim() || undefined,
                  provider,
                  remoteLlamaCpp: provider === 'remote_llamacpp' ? {
                    baseUrl: baseUrl.trim() || undefined,
                    model: model.trim() || undefined,
                    apiKey: apiKey.trim() || undefined,
                  } : undefined,
                });
                onSettingsChange({
                  defaultProvider: provider,
                  remoteLlamaCpp: { baseUrl, model, apiKey },
                });
                setRepository('');
                setBranch('');
                setShowNewSession(false);
              }}
              style={{
                width: '100%',
                background: provider === 'remote_llamacpp' && (!baseUrl.trim() || !model.trim()) ? 'rgba(255,255,255,0.06)' : 'rgba(35, 134, 54, 0.88)',
                color: '#fff',
                cursor: provider === 'remote_llamacpp' && (!baseUrl.trim() || !model.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              Start Session
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <input
          type="search"
          placeholder="Search sessions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="codex-search"
        />
      </div>

      <div className="codex-list">
        {search.trim() && filteredSessions.length === 0 && (
          <div className="codex-empty-state" style={{ paddingTop: 16, paddingBottom: 16 }}>
            No sessions match “{search.trim()}”.
          </div>
        )}
        {sessions.length === 0 && !showNewSession && (
          <div className="codex-empty-state" style={{ paddingTop: 20, paddingBottom: 20 }}>
            No sessions yet. Click "+ New" to start a session.
          </div>
        )}
        {(search.trim() ? filteredSessions : sessions).map(s => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`codex-list-item ${selected === s.id ? 'codex-list-item-active' : ''}`}
            style={{ borderLeftColor: statusColor[s.status] || '#8b949e' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="codex-list-item-title">
                {s.repository || 'Untitled'}
              </div>
              {s.status === 'failed' && (
                <button
                  className="codex-button codex-button-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReconnect(s.id);
                  }}
                  style={{ padding: '4px 8px', marginLeft: 8, color: '#58a6ff' }}
                >
                  ↻
                </button>
              )}
            </div>
            <div className="codex-list-item-subtitle">
              <span>{s.branch || 'no branch'}</span>
              <span>·</span>
              <span>{s.status}</span>
              {s.provider && (
                <>
                  <span>·</span>
                  <span>{s.provider === 'remote_llamacpp' ? 'llama.cpp' : 'default'}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11 }}>
      <span style={{ color: '#8b949e' }}>{label}</span>
      <span style={{ color: '#f0f6fc', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}
