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
  onRequestNewSession: () => Promise<void>;
  onError?: (message: string) => void;
}

const sandboxColors: Record<string, string> = {
  'danger-full-access': '#f85149',
  'on-request': '#d29922',
  'off': '#3fb950',
  'auto-approve': '#58a6ff',
};

function formatApprovalTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function ApprovalQueue({ sessionId, onApprove, onReject, onCopy, onOpen, onRequestNewSession, onError }: Props) {
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
          <div style={{ marginTop: 10 }}>
            <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
              Open new session drawer
            </button>
          </div>
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
          <div style={{ marginTop: 10 }}>
            <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
              Open new session drawer
            </button>
          </div>
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
            margin: 12,
            padding: 14,
            borderRadius: 14,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: `3px solid ${sandboxColors[approval.sandboxPolicy] || '#8b949e'}`,
            boxShadow: '0 10px 24px rgba(0,0,0,0.16)',
          }}
        >
          <div className="codex-toolbar" style={{ marginBottom: 12, padding: 0, borderBottom: 0, background: 'transparent', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#f0f6fc' }}>
                Approval Required
              </span>
              <span style={{ fontSize: 10, color: '#484f58' }}>
                {formatApprovalTime(approval.timestamp)}
              </span>
            </div>
            <div className="codex-chip-list">
              <div className="codex-chip" style={{ padding: '4px 8px', borderColor: sandboxColors[approval.sandboxPolicy] || '#8b949e' }}>
                <span className="codex-chip-label">Sandbox</span>
                <span className="codex-chip-value">{approval.sandboxPolicy}</span>
              </div>
              <div className="codex-chip" title={approval.workingDir} style={{ padding: '4px 8px' }}>
                <span className="codex-chip-label">Dir</span>
                <span className="codex-chip-value">{approval.workingDir}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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

          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>COMMAND</div>
              <button
                className="codex-button codex-button-secondary"
                style={{ padding: '5px 10px', fontSize: 11 }}
                onClick={() => onCopy(approval.command, 'Command')}
              >
                Copy command
              </button>
            </div>
            <pre style={{
              background: 'rgba(255,255,255,0.04)',
              padding: 10,
              borderRadius: 10,
              fontSize: 12,
              fontFamily: 'monospace',
              color: '#c9d1d9',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              border: '1px solid rgba(255,255,255,0.06)',
              margin: 0,
            }}>
              {approval.command}
            </pre>
          </div>

          {approval.affectedPaths.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>AFFECTED PATHS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
          </div>
        </div>
      ))}
    </div>
  );
}
