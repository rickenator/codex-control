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
}

const sandboxColors: Record<string, string> = {
  'danger-full-access': '#f85149',
  'on-request': '#d29922',
  'off': '#3fb950',
  'auto-approve': '#58a6ff',
};

export default function ApprovalQueue({ sessionId, onApprove, onReject }: Props) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setApprovals([]);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      const pending = await window.codexApi.getPendingApprovals(sessionId);
      if (!cancelled) setApprovals(pending);
    };

    refresh();
    const interval = window.setInterval(refresh, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId]);

  const handleApprove = async (id: string) => {
    await onApprove(id);
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  const handleReject = async (id: string) => {
    await onReject(id);
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  if (!sessionId) {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12 }}>
        <div style={{ color: '#484f58', fontSize: 13 }}>
          No session selected. Approval queue will appear when commands require approval.
        </div>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0d1117', padding: 12 }}>
        <div style={{ color: '#484f58', fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 1.5 }}>
          No pending approvals.
          <br />
          Commands that need review will appear here as they are queued.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
      {approvals.map(approval => (
        <div
          key={approval.id}
          style={{
            padding: 12,
            borderBottom: '1px solid #21262d',
            borderLeft: `3px solid ${sandboxColors[approval.sandboxPolicy] || '#8b949e'}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
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
              background: '#161b22',
              padding: 8,
              borderRadius: 4,
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
              onClick={() => handleApprove(approval.id)}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: '#238636',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              ✓ Approve
            </button>
            <button
              onClick={() => handleReject(approval.id)}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: '#da3633',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              ✗ Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
