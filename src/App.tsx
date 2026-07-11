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

  useEffect(() => {
    window.codexApi.listSessions().then(setSessions);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0d1117', color: '#c9d1d9' }}>
      {/* Left: Session list */}
      <SessionList
        sessions={sessions}
        selected={selectedSession}
        onSelect={setSelectedSession}
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
