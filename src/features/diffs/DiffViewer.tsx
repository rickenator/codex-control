import React, { useState, useEffect } from 'react';

interface GitStatusEntry {
  x: string;   // index status (empty, A, M, D, R, C)
  y: string;   // worktree status (empty, M, D, U)
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

interface Props {
  sessionId: string | null;
  repository?: string;
}

const statusIcons: Record<string, string> = {
  'M': '✏️',
  'A': '➕',
  'D': '❌',
  'R': '🔄',
  'C': '📋',
  'U': '⚠️',
};

const statusColors: Record<string, string> = {
  'M': '#d29922',
  'A': '#3fb950',
  'D': '#f85149',
  'R': '#a371f7',
  'C': '#58a6ff',
  'U': '#f85149',
};

export default function DiffViewer({ sessionId, repository }: Props) {
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hunks, setHunks] = useState<GitHunk[]>([]);
  const [acceptedHunks, setAcceptedHunks] = useState<Set<number>>(new Set());
  const [rejectedHunks, setRejectedHunks] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [actionResult, setActionResult] = useState<{type: 'success' | 'error', message: string} | null>(null);

  useEffect(() => {
    if (!sessionId || !repository) {
      setStatusEntries([]);
      setSelectedPath(null);
      setHunks([]);
      return;
    }
    loadGitStatus();
  }, [sessionId, repository]);

  const loadGitStatus = async () => {
    try {
      if (!repository) return;
      const entries = await window.codexApi.gitStatus(repository);
      if (Array.isArray(entries)) {
        setStatusEntries(entries);
      }
    } catch (e) {
      console.error('Failed to load git status:', e);
    }
  };

  const loadHunks = async (filePath: string) => {
    setSelectedPath(filePath);
    setLoading(true);
    setActionResult(null);
    try {
      const hunksData = await window.codexApi.gitDiffHunks(repository || '', filePath);
      if (Array.isArray(hunksData)) {
        setHunks(hunksData);
        setAcceptedHunks(new Set());
        setRejectedHunks(new Set());
      } else {
        setHunks([]);
      }
    } catch (e) {
      console.error('Failed to load hunks:', e);
      setHunks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptHunk = async (hunkId: number) => {
    if (!repository || !selectedPath) return;
    try {
      const result = await window.codexApi.gitApplyHunk(repository, selectedPath, hunkId);
      if (result === 'OK') {
        setAcceptedHunks(prev => new Set([...prev, hunkId]));
        setRejectedHunks(prev => {
          const next = new Set(prev);
          next.delete(hunkId);
          return next;
        });
        setActionResult({ type: 'success', message: `Hunk ${hunkId} applied` });
        // Refresh status after applying
        setTimeout(() => loadGitStatus(), 500);
      } else {
        setActionResult({ type: 'error', message: result || 'Failed to apply hunk' });
      }
    } catch (e) {
      setActionResult({ type: 'error', message: (e as Error).message });
    }
  };

  const handleRejectHunk = async (hunkId: number) => {
    if (!repository || !selectedPath) return;
    try {
      const result = await window.codexApi.gitRejectHunk(repository, selectedPath, hunkId);
      if (result === 'OK') {
        setRejectedHunks(prev => new Set([...prev, hunkId]));
        setAcceptedHunks(prev => {
          const next = new Set(prev);
          next.delete(hunkId);
          return next;
        });
        setActionResult({ type: 'success', message: `Hunk ${hunkId} rejected` });
        setTimeout(() => loadGitStatus(), 500);
      } else {
        setActionResult({ type: 'error', message: result || 'Failed to reject hunk' });
      }
    } catch (e) {
      setActionResult({ type: 'error', message: (e as Error).message });
    }
  };

  const handleAcceptAll = async () => {
    if (!repository || !selectedPath || hunks.length === 0) return;
    // Apply all hunks in reverse order so IDs stay valid
    for (let i = hunks.length - 1; i >= 0; i--) {
      await handleAcceptHunk(hunks[i].id);
    }
  };

  const handleRejectAll = async () => {
    if (!repository || !selectedPath || hunks.length === 0) return;
    for (let i = hunks.length - 1; i >= 0; i--) {
      await handleRejectHunk(hunks[i].id);
    }
  };

  const handleRefresh = () => {
    setActionResult(null);
    if (selectedPath && repository) {
      loadHunks(selectedPath);
    } else {
      loadGitStatus();
    }
  };

  // Parse diff content into colored lines for display
  const renderDiffLines = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return <span key={idx} style={{ color: '#3fb950' }}>{line}\n</span>;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return <span key={idx} style={{ color: '#f85149' }}>{line}\n</span>;
      } else {
        return <span key={idx} style={{ color: '#8b949e' }}>{line}\n</span>;
      }
    });
  };

  if (!sessionId || !repository) {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12 }}>
        <div style={{ color: '#484f58', fontSize: 13 }}>
          No repository selected. Diff view will appear when a session with a repository is active.
        </div>
      </div>
    );
  }

  if (statusEntries.length === 0) {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#8b949e' }}>Working tree status</span>
          <button onClick={handleRefresh} style={{
            padding: '4px 8px', background: '#21262d', border: '1px solid #30363d',
            borderRadius: 4, color: '#58a6ff', fontSize: 11, cursor: 'pointer',
          }}>↻ Refresh</button>
        </div>
        <div style={{ padding: 20, textAlign: 'center', color: '#484f58', fontSize: 13 }}>
          Working tree is clean. No changes detected.
        </div>
      </div>
    );
  }

  const selectedEntry = statusEntries.find(e => e.path === selectedPath);

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
      {/* Header */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#8b949e' }}>
          {statusEntries.length} change{statusEntries.length !== 1 ? 's' : ''} detected
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleRefresh} style={{
            padding: '4px 8px', background: '#21262d', border: '1px solid #30363d',
            borderRadius: 4, color: '#58a6ff', fontSize: 11, cursor: 'pointer',
          }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100% - 41px)' }}>
        {/* File list */}
        <div style={{ width: 220, borderRight: '1px solid #21262d', overflowY: 'auto' }}>
          {statusEntries.map(entry => (
            <div
              key={entry.path}
              onClick={() => loadHunks(entry.path)}
              style={{
                padding: '6px 12px', cursor: 'pointer',
                background: selectedPath === entry.path ? '#161b22' : 'transparent',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 11, color: statusColors[entry.x] || '#8b949e', fontWeight: 600, width: 16, textAlign: 'center' }}>
                {statusIcons[entry.x] || entry.x}
              </span>
              <span style={{ fontSize: 12, color: selectedPath === entry.path ? '#58a6ff' : '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {entry.path}
              </span>
            </div>
          ))}
        </div>

        {/* Diff content with per-hunk controls */}
        <div style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
          {!selectedEntry ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#484f58', fontSize: 13, marginTop: 40 }}>
              Select a file to view the diff.
            </div>
          ) : loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#8b949e', fontSize: 13 }}>
              Loading hunks...
            </div>
          ) : hunks.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#484f58', fontSize: 13 }}>
              No diff available for this file.
            </div>
          ) : (
            <div>
              {/* Action bar */}
              {actionResult && (
                <div style={{
                  padding: '6px 16px', fontSize: 12,
                  background: actionResult.type === 'success' ? '#0d1117' : '#3d1f1f',
                  color: actionResult.type === 'success' ? '#3fb950' : '#f85149',
                  borderBottom: '1px solid #21262d',
                }}>
                  {actionResult.message}
                </div>
              )}
              <div style={{
                padding: '6px 16px', borderBottom: '1px solid #21262d',
                display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>
                  {hunks.length} hunk{hunks.length !== 1 ? 's' : ''} in {selectedPath}
                </span>
                <button onClick={handleAcceptAll} style={{
                  padding: '3px 8px', background: '#238636', border: 'none',
                  borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer',
                }}>✓ Accept All</button>
                <button onClick={handleRejectAll} style={{
                  padding: '3px 8px', background: '#21262d', border: '1px solid #30363d',
                  borderRadius: 4, color: '#f85149', fontSize: 11, cursor: 'pointer',
                }}>✗ Reject All</button>
              </div>

              {/* Hunks */}
              {hunks.map(hunk => {
                const isAccepted = acceptedHunks.has(hunk.id);
                const isRejected = rejectedHunks.has(hunk.id);
                const statusColor = isAccepted ? '#3fb950' : isRejected ? '#f85149' : '#8b949e';
                const statusLabel = isAccepted ? '✓ applied' : isRejected ? '✗ rejected' : '';

                return (
                  <div key={hunk.id} style={{
                    borderBottom: '1px solid #21262d',
                    background: isAccepted ? '#0d1a0d' : isRejected ? '#1a0d0d' : 'transparent',
                  }}>
                    {/* Hunk header */}
                    <div style={{
                      padding: '4px 16px', fontSize: 11, color: statusColor,
                      background: '#161b22', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span>{hunk.header}</span>
                      {statusLabel && <span style={{ fontWeight: 600 }}>{statusLabel}</span>}
                    </div>

                    {/* Hunk content */}
                    <pre style={{
                      margin: 0, padding: '8px 16px', fontFamily: 'monospace', fontSize: 12,
                      lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {renderDiffLines(hunk.content)}
                    </pre>

                    {/* Per-hunk actions */}
                    <div style={{
                      padding: '4px 16px 8px', display: 'flex', gap: 6,
                    }}>
                      <button onClick={() => handleAcceptHunk(hunk.id)} disabled={isAccepted || isRejected} style={{
                        padding: '3px 10px', background: isAccepted ? '#238636' : '#21262d',
                        border: isAccepted ? 'none' : '1px solid #30363d',
                        borderRadius: 4, color: isAccepted ? '#fff' : '#3fb950',
                        fontSize: 11, cursor: isAccepted || isRejected ? 'default' : 'pointer',
                      }}>✓ Accept</button>
                      <button onClick={() => handleRejectHunk(hunk.id)} disabled={isRejected || isAccepted} style={{
                        padding: '3px 10px', background: isRejected ? '#21262d' : '#21262d',
                        border: isRejected ? 'none' : '1px solid #30363d',
                        borderRadius: 4, color: isRejected ? '#f85149' : '#f85149',
                        fontSize: 11, cursor: isRejected || isAccepted ? 'default' : 'pointer',
                      }}>✗ Reject</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
