import { useState, useEffect } from 'react';
import SessionList from './features/sessions/SessionList';
import EventTimeline from './features/sessions/EventTimeline';
import DiffViewer from './features/diffs/DiffViewer';
import TerminalPane from './components/TerminalPane';
import ApprovalQueue from './features/approvals/ApprovalQueue';

type Tab = 'terminal' | 'diff' | 'approvals';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('terminal');
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [recoveredSessions, setRecoveredSessions] = useState<string[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  useEffect(() => {
    // Load sessions on mount
    window.codexApi.listSessions().then(setSessions);

    // Listen for session recovery notifications
    const unsubscribeRecovery = window.codexApi.onSessionsRecovered((sessionIds: string[]) => {
      setRecoveredSessions(sessionIds);
      // Auto-select the first recovered session if none is selected
      if (!selectedSession && sessionIds.length > 0) {
        setSelectedSession(sessionIds[0]);
      }
    });

    // Listen for approval requests
    const unsubscribeApproval = window.codexApi.onApprovalRequest(() => {
      // Refresh pending count
      window.codexApi.getPendingApprovals().then((approvals: any[]) => {
        setPendingApprovalCount(approvals.length);
      });
    });

    return () => {
      unsubscribeRecovery();
      unsubscribeApproval();
    };
  }, [selectedSession]);

  const handleStartSession = async () => {
    try {
      const result = await window.codexApi.startSession({});
      // Refresh session list
      const updated = await window.codexApi.listSessions();
      setSessions(updated);
      setSelectedSession(result.sessionId);
    } catch (e) {
      console.error('Failed to start session:', e);
    }
  };

  const handleReconnect = async (sessionId: string) => {
    try {
      await window.codexApi.reconnectSession(sessionId);
      setSelectedSession(sessionId);
    } catch (e) {
      console.error('Failed to reconnect:', e);
    }
  };

  const handleApprove = async (id: string) => {
    await window.codexApi.approveCommand(id);
    // Refresh pending count
    const approvals = await window.codexApi.getPendingApprovals();
    setPendingApprovalCount(approvals.length);
  };

  const handleReject = async (id: string) => {
    await window.codexApi.rejectCommand(id);
    // Refresh pending count
    const approvals = await window.codexApi.getPendingApprovals();
    setPendingApprovalCount(approvals.length);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0d1117', color: '#c9d1d9' }}>
      {/* Recovery banner */}
      {recoveredSessions.length > 0 && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 280,
          right: 420,
          background: '#1a3a5c',
          border: '1px solid #58a6ff',
          borderRadius: '0 0 8px 8px',
          padding: '8px 16px',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, color: '#58a6ff' }}>
            {recoveredSessions.length} session(s) recovered from previous session
          </span>
          <button
            onClick={() => setRecoveredSessions([])}
            style={{
              padding: '4px 8px',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: 4,
              color: '#8b949e',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Left: Session list */}
      <SessionList
        sessions={sessions}
        selected={selectedSession}
        onSelect={setSelectedSession}
        onStartSession={handleStartSession}
        onReconnect={handleReconnect}
      />

      {/* Center: Event timeline */}
      <EventTimeline sessionId={selectedSession} />

      {/* Right: Terminal / Diff / Approvals tabs */}
      <aside style={{ width: 420, borderLeft: '1px solid #21262d', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #21262d' }}>
          {(['terminal', 'diff', 'approvals'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '8px 0', background: activeTab === tab ? '#161b22' : 'transparent',
                border: 'none', color: activeTab === tab ? '#58a6ff' : '#8b949e',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, textTransform: 'capitalize',
                position: 'relative',
              }}
            >
              {tab}
              {tab === 'approvals' && pendingApprovalCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: 4,
                  right: 8,
                  background: '#f85149',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: '50%',
                  width: 16,
                  height: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {pendingApprovalCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'terminal' && <TerminalPane sessionId={selectedSession} />}
          {activeTab === 'diff' && <DiffViewer sessionId={selectedSession} />}
          {activeTab === 'approvals' && (
            <ApprovalQueue
              sessionId={selectedSession}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
