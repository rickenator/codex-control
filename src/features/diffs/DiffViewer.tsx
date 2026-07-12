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
  onCopyPath: (path: string, label: string) => void;
  onOpenPath: (path: string, label: string) => void;
  onRequestNewSession: () => Promise<void>;
  onError?: (message: string) => void;
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

export default function DiffViewer({ sessionId, repository, onCopyPath, onOpenPath, onRequestNewSession, onError }: Props) {
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
      onError?.(`Could not load git status: ${(e as Error).message}`);
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
      onError?.(`Could not load diff hunks: ${(e as Error).message}`);
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
      const message = (e as Error).message;
      setActionResult({ type: 'error', message });
      onError?.(`Could not apply hunk: ${message}`);
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
      const message = (e as Error).message;
      setActionResult({ type: 'error', message });
      onError?.(`Could not reject hunk: ${message}`);
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

  // Parse diff content into colored lines with line numbers for display
  const renderDiffLines = (content: string) => {
    const lines = content.split('\n');
    let oldLine = 0;
    let newLine = 0;
    return lines.map((line, idx) => {
      if (line.startsWith('@@')) {
        // Parse hunk header to get starting line numbers
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        return <span key={idx} style={{ color: '#58a6ff', fontWeight: 600 }}>{line}\n</span>;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        const ln = newLine++;
        return <span key={idx} style={{ background: 'rgba(63, 185, 80, 0.12)', color: '#3fb950' }}><span style={{ color: '#3fb950', opacity: 0.6, marginRight: 8, userSelect: 'none', minWidth: 24, display: 'inline-block', textAlign: 'right' }}>{ln}</span>{line}\n</span>;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const ln = oldLine++;
        return <span key={idx} style={{ background: 'rgba(248, 81, 73, 0.12)', color: '#f85149' }}><span style={{ color: '#f85149', opacity: 0.6, marginRight: 8, userSelect: 'none', minWidth: 24, display: 'inline-block', textAlign: 'right' }}>{ln}</span>{line}\n</span>;
      } else {
        oldLine++; newLine++;
        return <span key={idx} style={{ color: '#6e7681' }}><span style={{ opacity: 0.4, marginRight: 8, userSelect: 'none', minWidth: 24, display: 'inline-block', textAlign: 'right' }}>{oldLine}</span>{line}\n</span>;
      }
    });
  };

  if (!sessionId || !repository) {
    return (
      <div className="codex-scroll-pane" style={{ padding: 12 }}>
        <div className="codex-empty-state" style={{ paddingTop: 0 }}>
          No repository selected. Diff view will appear when a session with a repository is active.
          <div style={{ marginTop: 10 }}>
            <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
              Open new session drawer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (statusEntries.length === 0) {
    return (
      <div className="codex-scroll-pane">
        <div className="codex-toolbar" style={{ fontSize: 13, color: '#8b949e' }}>
          <span>Working tree status</span>
          <button className="codex-button codex-button-secondary" onClick={handleRefresh} style={{ color: '#58a6ff' }}>↻ Refresh</button>
        </div>
        <div className="codex-empty-state">
          Working tree is clean. No changes detected.
          <div style={{ marginTop: 10 }}>
            <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
              Open new session drawer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedEntry = statusEntries.find(e => e.path === selectedPath);
  const repositoryLabel = repositoryLabelFromPath(repository);

  return (
    <div className="codex-scroll-pane">
      {/* Header */}
      <div className="codex-toolbar" style={{ fontSize: 13, color: '#8b949e', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ color: '#f0f6fc', fontWeight: 600 }}>
            {repositoryLabel}
          </span>
          <span>
            {statusEntries.length} change{statusEntries.length !== 1 ? 's' : ''} detected
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="codex-button codex-button-secondary" onClick={() => onCopyPath(repository || '', 'Repository path')} disabled={!repository}>
            Copy path
          </button>
          <button className="codex-button codex-button-secondary" onClick={() => onOpenPath(repository || '', 'Repository')} disabled={!repository}>
            Open folder
          </button>
          <button className="codex-button codex-button-secondary" onClick={handleRefresh} style={{ color: '#58a6ff' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100% - 41px)' }}>
        {/* File list */}
        <div className="codex-diff-list">
          {statusEntries.map(entry => {
            const changes = selectedPath === entry.path && hunks.length > 0
              ? hunks.reduce((acc, h) => {
                  const c = countChanges(h.content);
                  return { additions: acc.additions + c.additions, deletions: acc.deletions + c.deletions };
                }, { additions: 0, deletions: 0 })
              : null;
            return (
              <div
                key={entry.path}
                onClick={() => loadHunks(entry.path)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: selectedPath === entry.path ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ fontSize: 11, color: statusColors[entry.x] || '#8b949e', fontWeight: 700, width: 18, textAlign: 'center' }}>
                  {statusIcons[entry.x] || entry.x}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, color: selectedPath === entry.path ? '#58a6ff' : '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fileLabel(entry.path)}
                  </div>
                  <div style={{ fontSize: 10, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {changes ? `${changes.additions}+ ${changes.deletions}-` : entry.path}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Diff content with per-hunk controls */}
        <div className="codex-scroll-pane">
          {!selectedEntry ? (
            <div className="codex-empty-state" style={{ marginTop: 40 }}>
              Select a file to view the diff.
            </div>
          ) : loading ? (
            <div className="codex-empty-state" style={{ marginTop: 40 }}>
              Loading hunks...
            </div>
          ) : hunks.length === 0 ? (
            <div className="codex-empty-state" style={{ marginTop: 40 }}>
              No diff available for this file.
            </div>
          ) : (
            <div>
              {/* Action bar */}
              {actionResult && (
                <div style={{
                  padding: '6px 16px', fontSize: 12,
                  background: actionResult.type === 'success' ? 'rgba(63, 185, 80, 0.08)' : 'rgba(248, 81, 73, 0.10)',
                  color: actionResult.type === 'success' ? '#3fb950' : '#f85149',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  {actionResult.message}
                </div>
              )}
              <div style={{
                padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedEntry?.path || selectedPath}
                  </div>
                  <div style={{ fontSize: 11, color: '#8b949e' }}>
                    {hunks.length} hunk{hunks.length !== 1 ? 's' : ''} · {selectedEntry ? `${selectedEntry.x || ' '} ${selectedEntry.y || ' '}`.trim() : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="codex-button codex-button-primary" onClick={handleAcceptAll}>✓ Accept All</button>
                  <button className="codex-button codex-button-danger" onClick={handleRejectAll}>✗ Reject All</button>
                </div>
              </div>

              {/* Hunks */}
              {hunks.map(hunk => {
                const isAccepted = acceptedHunks.has(hunk.id);
                const isRejected = rejectedHunks.has(hunk.id);
                const statusColor = isAccepted ? '#3fb950' : isRejected ? '#f85149' : '#8b949e';
                const statusLabel = isAccepted ? '✓ applied' : isRejected ? '✗ rejected' : '';

                return (
                  <div key={hunk.id} style={{
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    background: isAccepted ? 'rgba(63, 185, 80, 0.05)' : isRejected ? 'rgba(248, 81, 73, 0.05)' : 'transparent',
                  }}>
                    {/* Hunk header */}
                    <div style={{
                      padding: '6px 16px', fontSize: 11, color: statusColor,
                      background: isAccepted ? 'rgba(63, 185, 80, 0.08)' : isRejected ? 'rgba(248, 81, 73, 0.08)' : 'rgba(88, 166, 255, 0.06)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}>
                      <span style={{ fontWeight: 500 }}>{hunk.header}</span>
                      {statusLabel && <span style={{ fontWeight: 600 }}>{statusLabel}</span>}
                    </div>

                    {/* Hunk content */}
                    <pre className="codex-code-block" style={{
                      background: '#0d1117',
                      margin: 0,
                      padding: '8px 0',
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}>
                      {renderDiffLines(hunk.content)}
                    </pre>

                    {/* Per-hunk actions */}
                    <div style={{ padding: '4px 16px 8px', display: 'flex', gap: 6 }}>
                      <button className="codex-button codex-button-primary" onClick={() => handleAcceptHunk(hunk.id)} disabled={isAccepted || isRejected} style={{ opacity: isAccepted || isRejected ? 0.9 : 1 }}>
                        ✓ Accept
                      </button>
                      <button className="codex-button codex-button-danger" onClick={() => handleRejectHunk(hunk.id)} disabled={isRejected || isAccepted} style={{ opacity: isRejected || isAccepted ? 0.9 : 1 }}>
                        ✗ Reject
                      </button>
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

function fileLabel(filePath: string) {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || filePath;
}

function countChanges(content: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of content.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

function repositoryLabelFromPath(repository?: string) {
  const trimmed = repository?.trim() || '';
  if (!trimmed) return 'Repository';
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}
