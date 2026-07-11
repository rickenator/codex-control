import React from 'react';

interface Props {
  sessionId: string | null;
}

export default function EventTimeline({ sessionId }: Props) {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d', fontSize: 13, color: '#8b949e' }}>
        {sessionId ? `Session: ${sessionId}` : 'Select a session to view events'}
      </div>
      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {!sessionId && (
          <div style={{ color: '#484f58', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            Connect to a Codex session to see the event timeline here.
          </div>
        )}
      </div>
    </main>
  );
}
