import React, { useState, useEffect } from 'react';

interface ApprovalRequest {
  id: string;
  sessionId: string;
  command: string;
  workingDir: string;
  sandboxPolicy: string;
  affectedPaths: string[];
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

interface Props {
  sessionId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCopy: (text: string, label: string) => void;
  onOpen: (path: string, label: string) => void;
  onError?: (message: string) => void;
}

const sandboxColors: Record<string, string> = {
  'danger-full-access': '#f85149',
  'on-request': '#d29922',
  'off': '#3fb950',
  'auto-approve': '#58a6ff',
};

export default function ApprovalQueue({ sessionId, onApprove, onReject, onCopy, onOpen, onError }: Props) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setApprovals([]);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const pending = await window.codexApi.getPendingApprovals(sessionId);
        if (!cancelled) setApprovals(pending);
      } catch (e) {
        if (!cancelled) {
          onError?.(`Could not refresh approvals: ${(e as Error).message}`);
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId]);

  const handleApprove = async (id: string) => {
    try {
      await onApprove(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      onError?.(`Could not approve command: ${(e as Error).message}`);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await onReject(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      onError?.(`Could not reject command: ${(e as Error).message}`);
    }
  };

  if (!sessionId) {
    return (
      <div className="codex-scroll-pane" style={{ padding: 12 }}>
        <div className="codex-empty-state" style={{ paddingTop: 0 }}>
          No session selected. Approval queue will appear when commands require approval.
        </div>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="codex-scroll-pane" style={{ padding: 12 }}>
        <div className="codex-empty-state" style={{ marginTop: 40 }}>
          No pending approvals.
          <br />
          Commands that need review will appear here as they are queued.
        </div>
      </div>
    );
  }

  return (
    <div className="codex-scroll-pane">
      {approvals.map(approval => (
        <div
          key={approval.id}
          style={{
            padding: 12,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            borderLeft: `3px solid ${sandboxColors[approval.sandboxPolicy] || '#8b949e'}`,
          }}
        >
          <div className="codex-toolbar" style={{ marginBottom: 8, padding: 0, borderBottom: 0, background: 'transparent' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f0f6fc' }}>
              Approval Required
            </span>
            <span style={{ fontSize: 10, color: '#484f58' }}>
              {new Date(approval.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Command details */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>COMMAND</div>
            <pre style={{
              background: 'rgba(255,255,255,0.03)',
              padding: 8,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'monospace',
              color: '#c9d1d9',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {approval.command}
            </pre>
          </div>

          {/* Working directory */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#8b949e' }}>Working dir: </span>
            <code style={{ fontSize: 11, color: '#58a6ff', fontFamily: 'monospace' }}>
              {approval.workingDir}
            </code>
          </div>

          {/* Sandbox policy */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#8b949e' }}>Sandbox: </span>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: sandboxColors[approval.sandboxPolicy] || '#8b949e',
            }}>
              {approval.sandboxPolicy}
            </span>
          </div>

          {/* Affected paths */}
          {approval.affectedPaths.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#8b949e' }}>Affected paths: </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {approval.affectedPaths.map((path, index) => (
                  <code key={index} style={{
                    fontSize: 10,
                    background: '#161b22',
                    padding: '2px 6px',
                    borderRadius: 3,
                    color: '#a371f7',
                    fontFamily: 'monospace',
                  }}>
                    {path}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="codex-button codex-button-primary"
              onClick={() => handleApprove(approval.id)}
            >
              ✓ Approve
            </button>
            <button
              className="codex-button codex-button-danger"
              onClick={() => handleReject(approval.id)}
            >
              ✗ Reject
            </button>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => onCopy(approval.command, 'Command')}
            >
              Copy command
            </button>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => onCopy(approval.workingDir, 'Working directory')}
            >
              Copy path
            </button>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => onOpen(approval.workingDir, 'Working directory')}
            >
              Open dir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
