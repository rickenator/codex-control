import { useState, useEffect, useMemo } from 'react';
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

type Notice = {
  kind: 'info' | 'success' | 'error';
  message: string;
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
    const saved = window.localStorage.getItem('consiglio:active-tab') ?? window.localStorage.getItem('consiglier:active-tab') ?? window.localStorage.getItem('codex-control:active-tab');
    return saved === 'diff' || saved === 'approvals' ? saved : 'terminal';
  });
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(() => window.localStorage.getItem('consiglio:selected-session') ?? window.localStorage.getItem('consiglier:selected-session') ?? window.localStorage.getItem('codex-control:selected-session'));
  const [recoveredSessions, setRecoveredSessions] = useState<string[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    window.codexApi.listSessions()
      .then(setSessions)
      .catch((error: Error) => setNotice({ kind: 'error', message: `Could not load sessions: ${error.message}` }));
    window.codexApi.getSettings()
      .then((loaded: AppSettings) => setSettings(loaded))
      .catch((error: Error) => setNotice({ kind: 'error', message: `Could not load settings: ${error.message}` }));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const unsubscribeRecovery = window.codexApi.onSessionsRecovered((sessionIds: string[]) => {
      setRecoveredSessions(sessionIds);
      setSelectedSession(prev => prev || sessionIds[0] || null);
    });

    const unsubscribeApproval = window.codexApi.onApprovalRequest(() => {
      window.codexApi.getPendingApprovals().then((approvals: ApprovalRecord[]) => {
        setPendingApprovalCount(approvals.length);
      });
    });

    const unsubscribeSessions = window.codexApi.onSessionsUpdated(setSessions);

    return () => {
      unsubscribeRecovery();
      unsubscribeApproval();
      unsubscribeSessions();
    };
  }, []);

  useEffect(() => {
    if (!sessions.length) return;
    const selectedStillExists = selectedSession && sessions.some(session => session.id === selectedSession);
    if (!selectedStillExists) {
      setSelectedSession(sessions[0].id);
    }
  }, [sessions, selectedSession]);

  useEffect(() => {
    window.localStorage.setItem('consiglio:active-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedSession) {
      window.localStorage.setItem('consiglio:selected-session', selectedSession);
    } else {
      window.localStorage.removeItem('consiglio:selected-session');
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

  const activeSession = useMemo(() => sessions.find(session => session.id === selectedSession), [sessions, selectedSession]);

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
      setNotice({ kind: 'success', message: `Started session for ${options.repository || 'the current workspace'}.` });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not start session: ${(e as Error).message}` });
    }
  };

  const handleReconnect = async (sessionId: string) => {
    try {
      const reconnected = await window.codexApi.reconnectSession(sessionId);
      if (!reconnected) {
        throw new Error('Session could not be reconnected');
      }
      setSelectedSession(sessionId);
      setNotice({ kind: 'success', message: 'Session reconnected.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not reconnect session: ${(e as Error).message}` });
    }
  };

  const handleStopSession = async (sessionId: string) => {
    try {
      const stopped = await window.codexApi.stopSession(sessionId);
      if (!stopped) {
        throw new Error('Session could not be stopped');
      }
      setNotice({ kind: 'info', message: 'Session stopped.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not stop session: ${(e as Error).message}` });
    }
  };

  const handleCopyText = async (text: string, label: string) => {
    try {
      const copied = await window.codexApi.copyText(text);
      if (!copied) {
        throw new Error('Clipboard unavailable');
      }
      setNotice({ kind: 'success', message: `${label} copied to clipboard.` });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not copy ${label.toLowerCase()}: ${(e as Error).message}` });
    }
  };

  const handleOpenPath = async (targetPath: string, label: string) => {
    try {
      const opened = await window.codexApi.openPath(targetPath);
      if (!opened) {
        throw new Error('File manager could not open the path');
      }
      setNotice({ kind: 'success', message: `${label} opened.` });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not open ${label.toLowerCase()}: ${(e as Error).message}` });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const approved = await window.codexApi.approveCommand(id);
      if (!approved) {
        throw new Error('Command could not be approved');
      }
      const approvals = await window.codexApi.getPendingApprovals();
      setPendingApprovalCount(approvals.length);
      setNotice({ kind: 'info', message: 'Approval granted.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not approve command: ${(e as Error).message}` });
    }
  };

  const handleReject = async (id: string) => {
    try {
      const rejected = await window.codexApi.rejectCommand(id);
      if (!rejected) {
        throw new Error('Command could not be rejected');
      }
      const approvals = await window.codexApi.getPendingApprovals();
      setPendingApprovalCount(approvals.length);
      setNotice({ kind: 'info', message: 'Approval rejected.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not reject command: ${(e as Error).message}` });
    }
  };

  const handleSettingsChange = async (nextSettings: AppSettings) => {
    try {
      setSettings(nextSettings);
      const saved = await window.codexApi.updateSettings(nextSettings);
      setSettings(saved);
      setNotice({ kind: 'success', message: 'Launch profile saved.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not save settings: ${(e as Error).message}` });
    }
  };

  const handlePickRepository = async () => {
    try {
      const folder = await window.codexApi.pickFolder();
      return folder;
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not open folder picker: ${(e as Error).message}` });
      return null;
    }
  };

  const handleTestRemoteLlamaCpp = async (config: { baseUrl: string; model: string; apiKey: string }) => {
    try {
      const result = await window.codexApi.testRemoteLlamaCpp(config);
      setNotice({
        kind: result.ok ? 'success' : 'error',
        message: result.message,
      });
      return result.ok;
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not test remote llama.cpp: ${(e as Error).message}` });
      return false;
    }
  };

  return (
    <div className="codex-app-shell">
      {notice && (
        <div className={`codex-banner ${notice.kind === 'error' ? 'codex-notice-error' : notice.kind === 'success' ? 'codex-notice-success' : 'codex-notice-info'}`}>
          <span style={{ fontSize: 13 }}>{notice.message}</span>
          <button className="codex-button codex-button-secondary" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {recoveredSessions.length > 0 && (
        <div className="codex-banner">
          <span style={{ fontSize: 13, color: '#58a6ff' }}>
            {recoveredSessions.length} session{recoveredSessions.length === 1 ? '' : 's'} recovered from the last run
          </span>
          <button
            className="codex-button codex-button-secondary"
            onClick={() => setRecoveredSessions([])}
          >
            Dismiss
          </button>
        </div>
      )}

      <header className="codex-page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, letterSpacing: 0.2, color: '#8b949e' }}>Consiglio</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#f0f6fc' }}>
            {activeSession?.repository || 'No session selected'}
          </div>
          <div style={{ fontSize: 12, color: '#8b949e' }}>
            {activeSession
              ? `${activeSession.branch || 'detached'} · ${activeSession.status}`
            : 'Start or select a session to continue'}
          </div>
        </div>
        <div className="codex-chip-list">
          <Pill label="Provider" value={settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp' : 'Default Codex'} />
          <Pill label="Model" value={settings.remoteLlamaCpp.model} />
          <Pill label="Endpoint" value={settings.remoteLlamaCpp.baseUrl} />
          {activeSession?.status && <Pill label="Session" value={activeSession.status} />}
        </div>
      </header>

      <div className="codex-shell-grid">
        <SessionList
          sessions={sessions}
          selected={selectedSession}
          onSelect={setSelectedSession}
          onStartSession={handleStartSession}
          onReconnect={handleReconnect}
          onPickRepository={handlePickRepository}
          onCopyPath={handleCopyText}
          onOpenPath={handleOpenPath}
          onTestRemote={handleTestRemoteLlamaCpp}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />

        <div className="codex-main-grid">
          <section className="codex-panel">
            <div className="codex-panel-header">
              <div className="codex-panel-title">
                <span className="codex-kicker">Session console</span>
                <span className="codex-panel-heading">{selectedSession || 'Select a session'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                {activeSession?.repository && (
                  <button
                    className="codex-button codex-button-secondary"
                    onClick={() => handleCopyText(activeSession.repository, 'Repository path')}
                  >
                    Copy repo
                  </button>
                )}
                {activeSession?.repository && (
                  <button
                    className="codex-button codex-button-secondary"
                    onClick={() => handleOpenPath(activeSession.repository, 'Workspace')}
                  >
                    Open folder
                  </button>
                )}
                {activeSession?.status === 'running' && selectedSession && (
                  <button
                    className="codex-button codex-button-danger"
                    onClick={() => handleStopSession(selectedSession)}
                  >
                    Stop
                  </button>
                )}
                {(['terminal', 'diff', 'approvals'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`codex-button ${activeTab === tab ? 'codex-button-info' : 'codex-button-secondary'}`}
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
              {activeTab === 'diff' && (
                <DiffViewer
                  sessionId={selectedSession}
                  repository={activeSession?.repository}
                  onCopyPath={handleCopyText}
                  onOpenPath={handleOpenPath}
                  onError={(message) => setNotice({ kind: 'error', message })}
                />
              )}
              {activeTab === 'approvals' && (
                <ApprovalQueue
                  sessionId={selectedSession}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onCopy={handleCopyText}
                  onOpen={handleOpenPath}
                  onError={(message) => setNotice({ kind: 'error', message })}
                />
              )}
            </div>
          </section>

          <section className="codex-panel">
            <div className="codex-panel-header">
              <div className="codex-panel-title">
                <span className="codex-kicker">Conversation</span>
                <span className="codex-panel-heading">Prompt, response, tools</span>
              </div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>Ctrl/Cmd + 1, 2, 3</div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <EventTimeline sessionId={selectedSession} compact />
            </div>
          </section>
        </div>
      </div>
      <footer className="codex-footer">
        <span>{sessions.length} session{sessions.length === 1 ? '' : 's'} tracked</span>
        <span>{pendingApprovalCount} approval{pendingApprovalCount === 1 ? '' : 's'} pending</span>
        <span>{settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp profile active' : 'Default Codex profile active'}</span>
      </footer>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="codex-chip">
      <span className="codex-chip-label">{label}</span>
      <span className="codex-chip-value">{value}</span>
    </div>
  );
}
