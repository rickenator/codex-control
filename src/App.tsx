import { useState, useEffect } from 'react';
import SessionList from './features/sessions/SessionList';
import EventTimeline from './features/sessions/EventTimeline';
import DiffViewer from './features/diffs/DiffViewer';
import TerminalPane from './components/TerminalPane';

type Tab = 'terminal' | 'diff';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('terminal');
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [recoveredSessions, setRecoveredSessions] = useState<string[]>([]);

  useEffect(() => {
    // Load sessions on mount
    window.codexApi.listSessions().then(setSessions);

    // Listen for session recovery notifications
    const unsubscribe = window.codexApi.onSessionsRecovered((sessionIds: string[]) => {
      setRecoveredSessions(sessionIds);
      // Auto-select the first recovered session if none is selected
      if (!selectedSession && sessionIds.length > 0) {
        setSelectedSession(sessionIds[0]);
      }
    });

    return () => unsubscribe();
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

      {/* Right: Terminal / Diff tabs */}
      <aside style={{ width: 420, borderLeft: '1px solid #21262d', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #21262d' }}>
          {(['terminal', 'diff'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '8px 0', background: activeTab === tab ? '#161b22' : 'transparent',
                border: 'none', color: activeTab === tab ? '#58a6ff' : '#8b949e',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, textTransform: 'capitalize',
              }}
            >{tab}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'terminal' ? (
            <TerminalPane sessionId={selectedSession} />
          ) : (
            <DiffViewer sessionId={selectedSession} />
          )}
        </div>
      </aside>
    </div>
  );
}
