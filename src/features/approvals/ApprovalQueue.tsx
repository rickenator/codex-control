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
          CLI-backed sessions show approval prompts in the live terminal.
          This pane is reserved for app-server approval events when that bridge is connected.
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
            margin: '0 12px 12px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.02)',
            border: `1px solid ${sandboxColors[approval.sandboxPolicy] || '#8b949e'}33`,
            borderLeft: `4px solid ${sandboxColors[approval.sandboxPolicy] || '#8b949e'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            transition: 'all 150ms ease',
          }}
        >
          <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>⏳</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f0f6fc' }}>
                Approval Required
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <div className="codex-chip" style={{ padding: '3px 8px', fontSize: 10, borderColor: sandboxColors[approval.sandboxPolicy] || '#8b949e' }}>
                <span className="codex-chip-label">Sandbox</span>
                <span className="codex-chip-value" style={{ color: sandboxColors[approval.sandboxPolicy] || '#8b949e', fontWeight: 600 }}>{approval.sandboxPolicy}</span>
              </div>
              <span style={{ fontSize: 10, color: '#6e7681' }}>{formatApprovalTime(approval.timestamp)}</span>
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

          <div style={{ padding: '8px 14px 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Command</div>
              <button
                className="codex-button codex-button-secondary"
                style={{ padding: '3px 8px', fontSize: 10 }}
                onClick={() => onCopy(approval.command, 'Command')}
              >
                Copy
              </button>
            </div>
            <pre style={{
              background: '#0d1117',
              padding: 10,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: '#c9d1d9',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              border: '1px solid rgba(255,255,255,0.06)',
              margin: 0,
              lineHeight: 1.5,
            }}>
              {approval.command}
            </pre>
          </div>

          {approval.affectedPaths.length > 0 && (
            <div style={{ padding: '4px 14px 8px' }}>
              <div style={{ fontSize: 10, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>Affected Paths ({approval.affectedPaths.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {approval.affectedPaths.map((path, index) => (
                  <code key={index} style={{
                    fontSize: 10,
                    background: 'rgba(163, 113, 247, 0.1)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    color: '#a371f7',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    border: '1px solid rgba(163, 113, 247, 0.2)',
                  }}>
                    {path}
                  </code>
                ))}
              </div>
            </div>
          )}

          <div style={{ padding: '8px 14px 12px', display: 'flex', gap: 8 }}>
            <button
              className="codex-button codex-button-primary"
              onClick={() => handleApprove(approval.id)}
              style={{ flex: 1 }}
            >
              ✓ Approve
            </button>
            <button
              className="codex-button codex-button-danger"
              onClick={() => handleReject(approval.id)}
              style={{ flex: 1 }}
            >
              ✗ Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
