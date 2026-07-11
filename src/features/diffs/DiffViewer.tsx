import React from 'react';

interface Props {
  sessionId: string | null;
}

export default function DiffViewer({ sessionId }: Props) {
  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12, fontFamily: 'monospace', fontSize: 12 }}>
      {!sessionId && (
        <div style={{ color: '#484f58' }}>
          No session selected. Diff view will appear when file changes are detected.
        </div>
      )}
    </div>
  );
}
