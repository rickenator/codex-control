import React, { useState } from 'react';

interface Session {
  id: string;
  repository?: string;
  branch?: string;
  status: string;
  updated_at: number;
}

interface Props {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
  onStartSession: () => void;
  onReconnect: (sessionId: string) => void;
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

export default function SessionList({ sessions, selected, onSelect, onStartSession, onReconnect }: Props) {
  const [showNewSession, setShowNewSession] = useState(false);

  return (
    <aside style={{ width: 280, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f0f6fc' }}>Sessions</h3>
          <button
            onClick={() => setShowNewSession(!showNewSession)}
            style={{
              padding: '4px 8px',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: 4,
              color: '#58a6ff',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + New
          </button>
        </div>

        {showNewSession && (
          <div style={{ marginTop: 8, padding: 8, background: '#0d1117', borderRadius: 6 }}>
            <input
              type="text"
              placeholder="Repository path"
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
            <button
              onClick={() => {
                onStartSession();
                setShowNewSession(false);
              }}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: '#238636',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Start Session
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sessions.length === 0 && !showNewSession && (
          <div style={{ padding: '20px 16px', color: '#484f58', fontSize: 13 }}>
            No sessions yet. Click "+ New" to start a Codex session.
          </div>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: selected === s.id ? '#161b22' : 'transparent',
              borderLeft: `3px solid ${statusColor[s.status] || '#8b949e'}`,
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
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
              {s.branch} · {s.status}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
