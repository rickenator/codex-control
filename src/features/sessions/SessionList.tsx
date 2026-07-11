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
    <aside style={{
      width: 320,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 14,
      background: 'rgba(13, 17, 23, 0.82)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f0f6fc' }}>Sessions</h3>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>Active workspaces and launch profiles</div>
          </div>
          <button
            onClick={() => setShowNewSession(!showNewSession)}
            style={{
              padding: '6px 10px',
              background: 'rgba(88, 166, 255, 0.12)',
              border: '1px solid rgba(88, 166, 255, 0.25)',
              borderRadius: 999,
              color: '#58a6ff',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + New
          </button>
        </div>

        <div style={{
          padding: 12,
          borderRadius: 12,
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600 }}>Default profile</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                {settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp' : 'Default Codex'}
              </span>
            </div>
            <button
              aria-label="Save default launch profile"
              onClick={() => onSettingsChange({
                defaultProvider: provider,
                remoteLlamaCpp: { baseUrl, model, apiKey },
              })}
              style={{
                padding: '5px 10px',
                background: 'rgba(35, 134, 54, 0.15)',
                border: '1px solid rgba(35, 134, 54, 0.35)',
                borderRadius: 999,
                color: '#3fb950',
                fontSize: 11,
                cursor: 'pointer',
              }}
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
              onClick={() => {
                setProvider('remote_llamacpp');
                setBaseUrl('http://192.168.1.240:8081');
                setModel('Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL');
                setApiKey('llama.cpp');
              }}
              style={{
                flex: 1,
                padding: '5px 10px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 999,
                color: '#c9d1d9',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Reset local draft
            </button>
          </div>
        </div>

        {showNewSession && (
          <div style={{ padding: 12, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <input
              type="text"
              placeholder="Repository path"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                marginBottom: 4,
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Branch (optional)"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                marginBottom: 8,
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#8b949e' }}>Provider</label>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'default' | 'remote_llamacpp')}
              style={{
                width: '100%',
                padding: '6px 8px',
                marginBottom: 8,
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
                fontSize: 12,
                outline: 'none',
              }}
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
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    marginBottom: 4,
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 4,
                    color: '#c9d1d9',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                <input
                  type="text"
                  placeholder="Model name"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    marginBottom: 4,
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 4,
                    color: '#c9d1d9',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
                <input
                  type="password"
                  placeholder="API key (optional)"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    marginBottom: 8,
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 4,
                    color: '#c9d1d9',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => onSettingsChange({
                  defaultProvider: 'remote_llamacpp',
                  remoteLlamaCpp: { baseUrl, model, apiKey },
                })}
                style={{
                  flex: 1,
                  padding: '5px 10px',
                  background: 'rgba(35, 134, 54, 0.15)',
                  border: '1px solid rgba(35, 134, 54, 0.35)',
                  borderRadius: 999,
                  color: '#3fb950',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Save as default
              </button>
            </div>
            <button
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
                padding: '6px 8px',
                background: provider === 'remote_llamacpp' && (!baseUrl.trim() || !model.trim()) ? '#30363d' : '#238636',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 12,
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
          style={{
            width: '100%',
            padding: '7px 10px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 10,
            color: '#c9d1d9',
            fontSize: 12,
            outline: 'none',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 4px' }}>
        {search.trim() && filteredSessions.length === 0 && (
          <div style={{ padding: '16px 14px', color: '#8b949e', fontSize: 12 }}>
            No sessions match “{search.trim()}”.
          </div>
        )}
        {sessions.length === 0 && !showNewSession && (
          <div style={{ padding: '20px 16px', color: '#484f58', fontSize: 13 }}>
            No sessions yet. Click "+ New" to start a session.
          </div>
        )}
        {(search.trim() ? filteredSessions : sessions).map(s => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: '10px 14px',
              cursor: 'pointer',
              background: selected === s.id ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
              borderLeft: `3px solid ${statusColor[s.status] || '#8b949e'}`,
              borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.repository || 'Untitled'}
              </div>
              {s.status === 'failed' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReconnect(s.id);
                  }}
                  style={{
                    padding: '2px 6px',
                    background: '#21262d',
                    border: '1px solid #30363d',
                    borderRadius: 3,
                    color: '#58a6ff',
                    fontSize: 10,
                    cursor: 'pointer',
                    marginLeft: 8,
                  }}
                >
                  ↻
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
