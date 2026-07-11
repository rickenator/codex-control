import React from 'react';

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
}

const statusColor: Record<string, string> = {
  idle: '#8b949e',
  running: '#58a6ff',
  awaiting_approval: '#d29922',
  paused: '#8b949e',
  failed: '#f85149',
  completed: '#3fb950',
};

export default function SessionList({ sessions, selected, onSelect }: Props) {
  return (
    <aside style={{ width: 280, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f0f6fc' }}>Sessions</h3>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sessions.length === 0 && (
          <div style={{ padding: '20px 16px', color: '#484f58', fontSize: 13 }}>
            No sessions yet. Start one from the CLI or connect to an existing session.
          </div>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: '8px 16px', cursor: 'pointer',
              background: selected === s.id ? '#161b22' : 'transparent',
              borderLeft: `3px solid ${statusColor[s.status] || '#8b949e'}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.repository || 'Untitled'}
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
