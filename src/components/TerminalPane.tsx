import React, { useRef, useEffect } from 'react';

interface Props {
  sessionId: string | null;
}

export default function TerminalPane({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // TODO: Initialize xterm.js and attach to the Codex session's PTY
    // For now, this is a placeholder
  }, [sessionId]);

  return (
    <div ref={containerRef} style={{ flex: 1, background: '#000', padding: 4 }}>
      {!sessionId && (
        <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12, padding: 8 }}>
          Raw terminal pane — xterm.js integration (M1)
        </div>
      )}
      {sessionId && (
        <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12, padding: 8 }}>
          Terminal output for session: {sessionId}
        </div>
      )}
    </div>
  );
}
