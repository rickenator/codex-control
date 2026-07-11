import React, { useState, useEffect } from 'react';

interface Props {
  sessionId: string | null;
}

export default function DiffViewer({ sessionId }: Props) {
  const [diffs, setDiffs] = useState<{ path: string; content: string }[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setDiffs([]);
      return;
    }

    // TODO: Fetch diffs from the session or git status
    // For now, this is a placeholder
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12 }}>
        <div style={{ color: '#484f58', fontSize: 13 }}>
          No session selected. Diff view will appear when file changes are detected.
        </div>
      </div>
    );
  }

  if (diffs.length === 0) {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12 }}>
        <div style={{ color: '#484f58', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          No file changes yet. Diffs will appear when the session modifies files.
        </div>
      </div>
    );
  }

  const selectedDiff = diffs.find(d => d.path === selectedPath);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* File list */}
      <div style={{ width: 180, borderRight: '1px solid #21262d', overflowY: 'auto' }}>
        {diffs.map(d => (
          <div
            key={d.path}
            onClick={() => setSelectedPath(d.path)}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              background: selectedPath === d.path ? '#161b22' : 'transparent',
              fontSize: 12,
              color: selectedPath === d.path ? '#58a6ff' : '#8b949e',
            }}
          >
            {d.path}
          </div>
        ))}
      </div>

      {/* Diff content */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12, fontFamily: 'monospace', fontSize: 12 }}>
        {selectedDiff ? (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#c9d1d9' }}>
            {selectedDiff.content}
          </pre>
        ) : (
          <div style={{ color: '#484f58', fontSize: 13 }}>Select a file to view the diff.</div>
        )}
      </div>
    </div>
  );
}
