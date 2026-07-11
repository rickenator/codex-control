import { useState, useEffect } from 'react';
import SessionList from './features/sessions/SessionList';
import EventTimeline from './features/sessions/EventTimeline';
import DiffViewer from './features/diffs/DiffViewer';
import TerminalPane from './components/TerminalPane';
import ApprovalQueue from './features/approvals/ApprovalQueue';

type Tab = 'terminal' | 'diff' | 'approvals';

type AppSettings = {
  defaultProvider: 'default' | 'remote_llamacpp';
  remoteLlamaCpp: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
};

const defaultSettings: AppSettings = {
  defaultProvider: 'remote_llamacpp',
  remoteLlamaCpp: {
    baseUrl: 'http://192.168.1.240:8081',
    model: 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL',
    apiKey: 'llama.cpp',
  },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = window.localStorage.getItem('codex-control:active-tab');
    return saved === 'diff' || saved === 'approvals' ? saved : 'terminal';
  });
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(() => window.localStorage.getItem('codex-control:selected-session'));
  const [recoveredSessions, setRecoveredSessions] = useState<string[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    window.codexApi.listSessions().then(setSessions);
    window.codexApi.getSettings().then((loaded: AppSettings) => setSettings(loaded)).catch(() => {});

    const unsubscribeRecovery = window.codexApi.onSessionsRecovered((sessionIds: string[]) => {
      setRecoveredSessions(sessionIds);
      if (!selectedSession && sessionIds.length > 0) {
        setSelectedSession(sessionIds[0]);
      }
    });

    const unsubscribeApproval = window.codexApi.onApprovalRequest(() => {
      window.codexApi.getPendingApprovals().then((approvals: any[]) => {
        setPendingApprovalCount(approvals.length);
      });
    });

    return () => {
      unsubscribeRecovery();
      unsubscribeApproval();
    };
  }, [selectedSession]);

  useEffect(() => {
    if (!sessions.length) return;
    const selectedStillExists = selectedSession && sessions.some(session => session.id === selectedSession);
    if (!selectedStillExists) {
      setSelectedSession(sessions[0].id);
    }
  }, [sessions, selectedSession]);

  useEffect(() => {
    window.localStorage.setItem('codex-control:active-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedSession) {
      window.localStorage.setItem('codex-control:selected-session', selectedSession);
    } else {
      window.localStorage.removeItem('codex-control:selected-session');
    }
  }, [selectedSession]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === '1') {
        setActiveTab('terminal');
        event.preventDefault();
      } else if (event.key === '2') {
        setActiveTab('diff');
        event.preventDefault();
      } else if (event.key === '3') {
        setActiveTab('approvals');
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const activeSession = sessions.find(session => session.id === selectedSession);

  const handleStartSession = async (options: {
    repository?: string;
    branch?: string;
    provider?: 'default' | 'remote_llamacpp';
    remoteLlamaCpp?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
  }) => {
    try {
      const result = await window.codexApi.startSession(options);
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
    const approvals = await window.codexApi.getPendingApprovals();
    setPendingApprovalCount(approvals.length);
  };

  const handleSettingsChange = async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    const saved = await window.codexApi.updateSettings(nextSettings);
    setSettings(saved);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: '#0b1020', color: '#c9d1d9' }}>
      {recoveredSessions.length > 0 && (
        <div style={{
          margin: '12px 12px 0',
          background: 'rgba(88, 166, 255, 0.12)',
          border: '1px solid rgba(88, 166, 255, 0.35)',
          borderRadius: 10,
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}>
          <span style={{ fontSize: 13, color: '#58a6ff' }}>
            {recoveredSessions.length} session(s) recovered from previous session
          </span>
            <button
              onClick={() => setRecoveredSessions([])}
              style={{
                padding: '4px 8px',
                background: 'rgba(13, 17, 23, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
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

      <header style={{
        margin: '12px',
        padding: '12px 16px',
        borderRadius: 14,
        background: 'rgba(13, 17, 23, 0.82)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, letterSpacing: 0.2, color: '#8b949e' }}>Codex Control</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#f0f6fc' }}>
            {activeSession?.repository || 'No session selected'}
          </div>
          <div style={{ fontSize: 12, color: '#8b949e' }}>
            {activeSession
              ? `${activeSession.branch || 'detached'} · ${activeSession.status}`
              : 'Start or select a session to continue'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Pill label="Provider" value={settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp' : 'Default Codex'} />
          <Pill label="Model" value={settings.remoteLlamaCpp.model} />
          <Pill label="Endpoint" value={settings.remoteLlamaCpp.baseUrl} />
          {activeSession?.status && <Pill label="Session" value={activeSession.status} />}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, padding: '0 12px 12px' }}>
        <SessionList
          sessions={sessions}
          selected={selectedSession}
          onSelect={setSelectedSession}
          onStartSession={handleStartSession}
          onReconnect={handleReconnect}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />

        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 420px',
          gap: 12,
        }}>
          <section style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 14,
            background: 'rgba(13, 17, 23, 0.82)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Session console</span>
                <span style={{ fontSize: 13, color: '#f0f6fc' }}>{selectedSession || 'Select a session'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {(['terminal', 'diff', 'approvals'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '6px 10px',
                      background: activeTab === tab ? 'rgba(88, 166, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 999,
                      color: activeTab === tab ? '#58a6ff' : '#8b949e',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                      textTransform: 'capitalize',
                      position: 'relative',
                    }}
                  >
                    {tab}
                    {tab === 'approvals' && pendingApprovalCount > 0 && (
                      <span style={{
                        marginLeft: 6,
                        background: '#f85149',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 700,
                        borderRadius: '50%',
                        width: 16,
                        height: 16,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {pendingApprovalCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {activeTab === 'terminal' && <TerminalPane sessionId={selectedSession} compact />}
              {activeTab === 'diff' && <DiffViewer sessionId={selectedSession} repository={activeSession?.repository} />}
              {activeTab === 'approvals' && (
                <ApprovalQueue
                  sessionId={selectedSession}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              )}
            </div>
          </section>

          <section style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 14,
            background: 'rgba(13, 17, 23, 0.82)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Conversation</span>
                <span style={{ fontSize: 13, color: '#f0f6fc' }}>Prompt, response, tools</span>
              </div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Ctrl/Cmd + 1, 2, 3</div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <EventTimeline sessionId={selectedSession} compact />
            </div>
          </section>
        </div>
      </div>
      <footer style={{
        margin: '0 12px 12px',
        padding: '8px 14px',
        borderRadius: 12,
        background: 'rgba(13, 17, 23, 0.72)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        fontSize: 11,
        color: '#8b949e',
      }}>
        <span>{sessions.length} session{sessions.length === 1 ? '' : 's'} tracked</span>
        <span>{pendingApprovalCount} approval{pendingApprovalCount === 1 ? '' : 's'} pending</span>
        <span>{settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp profile active' : 'Default Codex profile active'}</span>
      </footer>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 999,
      background: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: '#c9d1d9',
      fontSize: 12,
      maxWidth: '100%',
    }}>
      <span style={{ color: '#8b949e' }}>{label}</span>
      <span style={{ color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}
