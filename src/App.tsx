import { useState, useEffect, useMemo } from 'react';
import SessionList from './features/sessions/SessionList';
import EventTimeline from './features/sessions/EventTimeline';
import DiffViewer from './features/diffs/DiffViewer';
import TerminalPane from './components/TerminalPane';
import ApprovalQueue from './features/approvals/ApprovalQueue';

type Tab = 'terminal' | 'diff' | 'approvals';

type LanProviderConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
};

type AppSettings = {
  defaultProvider: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan';
  remoteLlamaCpp: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  lanProviders: LanProviderConfig[];
  defaultModel?: string;
};

type Notice = {
  kind: 'info' | 'success' | 'error';
  message: string;
};

const defaultSettings: AppSettings = {
  defaultProvider: 'remote_llamacpp',
  remoteLlamaCpp: {
    baseUrl: 'http://192.168.1.243:8081',
    model: 'unsloth/Qwen3.6-35B-A3B-GGUF',
    apiKey: 'llama.cpp',
  },
  lanProviders: [],
  defaultModel: 'unsloth/Qwen3.6-35B-A3B-GGUF',
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
  const [providerStatus, setProviderStatus] = useState<Record<string, 'ok' | 'error' | 'checking' | null>>({});
  const [startupStatus, setStartupStatus] = useState<StartupStatus | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [showLanSettings, setShowLanSettings] = useState(false);
  const [lanForm, setLanForm] = useState<{ id: string; name: string; host: string; port: string; model: string; apiKey: string }>({
    id: '', name: '', host: '', port: '8081', model: '', apiKey: '',
  });
  const [discovering, setDiscovering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleDiscoverLan = async () => {
    setDiscovering(true);
    try {
      const result = await window.codexApi.lanDiscover();
      if (result.error) {
        setNotice({ kind: 'error', message: `LAN discovery failed: ${result.error}` });
      } else if (result.added > 0) {
        setNotice({ kind: 'success', message: `Found ${result.found} servers, added ${result.added} new providers` });
        // Refresh settings
        window.codexApi.getSettings().then(setSettings);
      } else {
        setNotice({ kind: 'info', message: `Scanned network: ${result.found} server(s) found, none new` });
      }
    } catch (e) {
      setNotice({ kind: 'error', message: `LAN discovery failed: ${(e as Error).message}` });
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    window.codexApi.listSessions()
      .then(setSessions)
      .catch((error: Error) => setNotice({ kind: 'error', message: `Could not load sessions: ${error.message}` }));
    window.codexApi.getSettings()
      .then(setSettings)
      .catch((error: Error) => setNotice({ kind: 'error', message: `Could not load settings: ${error.message}` }));
    window.codexApi.getStartupStatus()
      .then(setStartupStatus)
      .catch((error: Error) => setNotice({ kind: 'error', message: `Could not run startup checks: ${error.message}` }));
    window.codexApi.checkProviders()
      .then((checks: Array<{ id: string; status: string; message: string }>) => {
        const status: Record<string, 'ok' | 'error' | 'checking' | null> = {};
        checks.forEach(c => { status[c.id] = c.status === 'ok' ? 'ok' : c.status === 'error' ? 'error' : null; });
        setProviderStatus(status);
      })
      .catch(() => {});
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

    const unsubscribeSettings = window.codexApi.onSettingsChanged((s) => setSettings(s));
    const unsubscribeSessions = window.codexApi.onSessionsUpdated(setSessions);

    return () => {
      unsubscribeRecovery();
      unsubscribeApproval();
      unsubscribeSessions();
      unsubscribeSettings();
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
    provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan';
    selectedLanProviderId?: string;
    lanProvider?: {
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

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await window.codexApi.deleteSession(sessionId);
      setNotice({ kind: 'info', message: 'Session deleted.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not delete session: ${(e as Error).message}` });
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

  const handleRequestNewSession = async () => {
    try {
      await window.codexApi.requestNewSession();
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not open new session drawer: ${(e as Error).message}` });
    }
  };

  const handleRefreshStartupStatus = async () => {
    if (isRefreshingStatus) return;
    setIsRefreshingStatus(true);
    try {
      const refreshed = await window.codexApi.getStartupStatus();
      setStartupStatus(refreshed);
      setNotice({ kind: refreshed.appUpdate.updateAvailable ? 'success' : 'info', message: refreshed.appUpdate.message });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not refresh health checks: ${(e as Error).message}` });
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const healthSummary = summarizeHealth(startupStatus);

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

      <section className="codex-banner" style={{ alignItems: 'stretch', background: 'rgba(255,255,255,0.035)', borderColor: healthSummary.borderColor }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: '#f0f6fc', fontWeight: 700, fontSize: 13 }}>Startup health and updates</span>
              <span style={{ color: healthSummary.color, fontSize: 12 }}>{healthSummary.message}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {startupStatus?.appUpdate.releaseUrl && startupStatus.appUpdate.updateAvailable && (
                <button className="codex-button codex-button-info" onClick={() => void handleOpenPath(startupStatus.appUpdate.releaseUrl!, 'Release page')}>
                  Open release
                </button>
              )}
              <button className="codex-button codex-button-secondary" onClick={() => void handleRefreshStartupStatus()} disabled={isRefreshingStatus}>
                {isRefreshingStatus ? 'Checking…' : 'Re-check'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(providerStatus).map(([id, status]) => (
              <HealthPill key={id} label={id} status={status || 'checking'} message={status === 'ok' ? 'Provider ready' : status === 'error' ? 'Connection failed' : 'Checking…'} />
            ))}
            {startupStatus ? (
              <>
                <HealthPill label="Consiglio" status={startupStatus.appUpdate.updateAvailable ? 'warning' : startupStatus.appUpdate.status} message={startupStatus.appUpdate.latestVersion ? `${startupStatus.appUpdate.currentVersion} → ${startupStatus.appUpdate.latestVersion}` : startupStatus.appUpdate.currentVersion} />
                {startupStatus.checks.map(check => (
                  <HealthPill key={check.id} label={check.label} status={check.status} message={check.message} />
                ))}
              </>
            ) : (
              <HealthPill label="Checks" status="checking" message="Checking app releases, Codex CLI, and provider interfaces…" />
            )}
          </div>
        </div>
      </section>

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
        <button
          className="codex-button codex-button-secondary"
          onClick={() => setShowSettings(true)}
          style={{ fontSize: 11, padding: "4px 10px", marginLeft: 8 }}
          title="Launch settings"
        >
          ⚙ Settings
        </button>
        <div className="codex-chip-list">
          <Pill label="Provider" value={settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp' : settings.defaultProvider === 'gpt56' ? 'GPT-5.6' : settings.defaultProvider === 'lan' ? 'LAN' : 'Default Codex'} />
          <Pill label="Model" value={
            activeSession?.model ||
            settings.defaultProvider === "remote_llamacpp" ? settings.remoteLlamaCpp.model :
            settings.defaultProvider === "default" ? (settings.defaultModel || settings.remoteLlamaCpp.model) :
            settings.defaultProvider === "gpt56" ? "gpt-5.6" :
            settings.defaultProvider === "lan" ? (settings.lanProviders[0]?.model || "Not set") :
            settings.remoteLlamaCpp.model
          } />
          <Pill label="Endpoint" value={
            settings.defaultProvider === "remote_llamacpp" ? settings.remoteLlamaCpp.baseUrl :
            settings.defaultProvider === "lan" ? (settings.lanProviders[0] ? `${settings.lanProviders[0].host}:${settings.lanProviders[0].port}` : "Not set") :
            "N/A"
          } />
          {activeSession?.status && <Pill label="Session" value={activeSession.status} />}
        </div>
      </header>

      <div className="codex-shell-grid">
        <SessionList
          sessions={sessions}
          selected={selectedSession}
          onSelect={setSelectedSession}
          onStartSession={(opts: any) => handleStartSession(opts)}
          onReconnect={handleReconnect}
          onPickRepository={handlePickRepository}
          onCopyPath={handleCopyText}
          onOpenPath={handleOpenPath}
          onTestRemote={handleTestRemoteLlamaCpp}
          onRequestNewSession={handleRequestNewSession}
          onStopSession={handleStopSession}
          onDeleteSession={handleDeleteSession}
          settings={{ ...settings, lanProviders: settings.lanProviders || [] }}
          onSettingsChange={(s: any) => handleSettingsChange(s)}
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
              {activeTab === 'terminal' && (
                <TerminalPane
                  sessionId={selectedSession}
                  compact
                  onCopyTranscript={handleCopyText}
                  onRequestNewSession={handleRequestNewSession}
                />
              )}
              {activeTab === 'diff' && (
                <DiffViewer
                  sessionId={selectedSession}
                  repository={activeSession?.repository}
                  onCopyPath={handleCopyText}
                  onOpenPath={handleOpenPath}
                  onRequestNewSession={handleRequestNewSession}
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
                  onRequestNewSession={handleRequestNewSession}
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
              <EventTimeline
                sessionId={selectedSession}
                compact
                onCopySessionId={(value) => handleCopyText(value, 'Event ID')}
                onRequestNewSession={handleRequestNewSession}
              />
            </div>
          </section>
        </div>
      </div>
      <footer className="codex-footer" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ color: '#f0f6fc', fontWeight: 600 }}>
            {activeSession?.repository ? sessionLabel(activeSession.repository) : 'No session selected'}
          </span>
          <span>
            {activeSession
              ? `${activeSession.branch || 'detached'} · ${activeSession.status}`
              : 'Pick a session or start a workspace to continue'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right', marginLeft: 'auto' }}>
          <span>{sessions.length} session{sessions.length === 1 ? '' : 's'} tracked</span>
          <span>{pendingApprovalCount} approval{pendingApprovalCount === 1 ? '' : 's'} pending</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right' }}>
          <span>{settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp profile active' : settings.defaultProvider === 'gpt56' ? 'GPT-5.6 profile active' : settings.defaultProvider === 'lan' ? 'LAN provider active' : 'Default Codex profile active'}</span>
          <span>Ctrl/Cmd+N new session · Ctrl/Cmd+L search · 1/2/3 tabs</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {settings.lanProviders.length > 0 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {settings.lanProviders.map(p => (
                <div key={p.id} className="codex-chip" style={{ padding: '4px 8px', fontSize: 10 }}>
                  <span className="codex-chip-label">{p.name}</span>
                  <span className="codex-chip-value">{p.host}:{p.port}</span>
                  <button
                    className="codex-button codex-button-secondary"
                    onClick={() => {
                      setLanForm({ id: p.id, name: p.name, host: p.host, port: String(p.port), model: p.model, apiKey: p.apiKey });
                      setShowLanSettings(true);
                    }}
                    style={{ padding: '2px 6px', fontSize: 10, marginLeft: 4 }}
                  >
                    ✎
                  </button>
                  <button
                    className="codex-button codex-button-secondary"
                    onClick={() => {
                      window.codexApi.lanRemoveProvider(p.id);
                      setSettings({ ...settings, lanProviders: settings.lanProviders.filter(lp => lp.id !== p.id) });
                      setNotice({ kind: 'info', message: 'Provider removed' });
                    }}
                    style={{ padding: '2px 6px', fontSize: 10, marginLeft: 2, color: '#f85149' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="codex-button codex-button-secondary"
            onClick={() => {
              setLanForm({ id: '', name: '', host: '', port: '8081', model: '', apiKey: '' });
              setShowLanSettings(true);
            }}
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            + Add Provider
          </button>
          <button
            className="codex-button codex-button-secondary"
            onClick={handleDiscoverLan}
            disabled={discovering}
            style={{ fontSize: 11, padding: '4px 8px', color: '#58a6ff' }}
          >
            {discovering ? 'Scanning...' : '🔍 Discover'}
          </button>
        </div>
      </footer>

      {/* LAN Settings Modal */}
      {showLanSettings && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowLanSettings(false)}>
          <div style={{
            background: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
            padding: 24, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f0f6fc' }}>
              {lanForm.id ? 'Edit LAN Provider' : 'Add LAN Provider'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                placeholder="Name (e.g., Godzilla)"
                value={lanForm.name}
                onChange={e => setLanForm({ ...lanForm, name: e.target.value })}
                className="codex-input"
              />
              <input
                type="text"
                placeholder="Host (e.g., 192.168.1.243)"
                value={lanForm.host}
                onChange={e => setLanForm({ ...lanForm, host: e.target.value })}
                className="codex-input"
              />
              <input
                type="number"
                placeholder="Port (e.g., 8081)"
                value={lanForm.port}
                onChange={e => setLanForm({ ...lanForm, port: e.target.value })}
                className="codex-input"
              />
              <input
                type="text"
                placeholder="Model (optional)"
                value={lanForm.model}
                onChange={e => setLanForm({ ...lanForm, model: e.target.value })}
                className="codex-input"
              />
              <input
                type="password"
                placeholder="API Key (optional)"
                value={lanForm.apiKey}
                onChange={e => setLanForm({ ...lanForm, apiKey: e.target.value })}
                className="codex-input"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                className="codex-button codex-button-secondary"
                onClick={() => setShowLanSettings(false)}
              >
                Cancel
              </button>
              <button
                className="codex-button codex-button-primary"
                onClick={() => {
                  if (!lanForm.host || !lanForm.port) {
                    setNotice({ kind: 'error', message: 'Host and port are required' });
                    return;
                  }
                  const provider = {
                    id: lanForm.id || `lan-${Date.now()}`,
                    name: lanForm.name || `${lanForm.host}:${lanForm.port}`,
                    host: lanForm.host,
                    port: parseInt(lanForm.port, 10),
                    model: lanForm.model,
                    apiKey: lanForm.apiKey,
                  };
                  if (lanForm.id) {
                    window.codexApi.lanUpdateProvider(provider);
                  } else {
                    window.codexApi.lanAddProvider(provider);
                  }
                  setSettings({ ...settings, lanProviders: [...settings.lanProviders, provider] });
                  setShowLanSettings(false);
                  setLanForm({ id: '', name: '', host: '', port: '8081', model: '', apiKey: '' });
                  setNotice({ kind: 'success', message: 'LAN provider saved' });
                }}
              >
                {lanForm.id ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* General Settings Modal */}
      {showSettings && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowSettings(false)}>
          <div style={{
            background: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
            padding: 24, width: 520, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f0f6fc' }}>
              Launch Settings
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Default Provider */}
              <div>
                <label style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' }}>Default Provider</label>
                <select
                  value={settings.defaultProvider}
                  onChange={e => setSettings({ ...settings, defaultProvider: e.target.value as any })}
                  className="codex-select"
                  style={{ width: '100%', fontSize: 12, padding: '6px 8px', background: '#0d1117', color: '#f0f6fc', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }}
                >
                  <option value="remote_llamacpp">Remote llama.cpp (godzilla)</option>
                  <option value="default">Default Codex</option>
                  <option value="gpt56">GPT-5.6</option>
                  <option value="lan">LAN Provider</option>
                </select>
              </div>

              {/* Default Model */}
              <div>
                <label style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' }}>Default Model (for Default provider)</label>
                <input
                  type="text"
                  value={settings.defaultModel || settings.remoteLlamaCpp.model}
                  onChange={e => setSettings({ ...settings, defaultModel: e.target.value })}
                  className="codex-input"
                  placeholder="unsloth/Qwen3.6-35B-A3B-GGUF"
                />
              </div>

              {/* Remote llama.cpp Settings */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                <label style={{ fontSize: 13, color: '#f0f6fc', fontWeight: 600, marginBottom: 8, display: 'block' }}>Remote llama.cpp</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Base URL (e.g., http://192.168.1.243:8081)"
                    value={settings.remoteLlamaCpp.baseUrl}
                    onChange={e => setSettings({ ...settings, remoteLlamaCpp: { ...settings.remoteLlamaCpp, baseUrl: e.target.value } })}
                    className="codex-input"
                  />
                  <input
                    type="text"
                    placeholder="Model"
                    value={settings.remoteLlamaCpp.model}
                    onChange={e => setSettings({ ...settings, remoteLlamaCpp: { ...settings.remoteLlamaCpp, model: e.target.value } })}
                    className="codex-input"
                  />
                  <input
                    type="password"
                    placeholder="API Key"
                    value={settings.remoteLlamaCpp.apiKey}
                    onChange={e => setSettings({ ...settings, remoteLlamaCpp: { ...settings.remoteLlamaCpp, apiKey: e.target.value } })}
                    className="codex-input"
                  />
                </div>
              </div>

              {/* LAN Providers Summary */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: '#f0f6fc', fontWeight: 600 }}>LAN Providers</label>
                  <button
                    className="codex-button codex-button-secondary"
                    onClick={() => { setShowSettings(false); setShowLanSettings(true); }}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                  >
                    Manage
                  </button>
                </div>
                {settings.lanProviders.length === 0 ? (
                  <span style={{ fontSize: 12, color: '#8b949e' }}>No LAN providers configured</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {settings.lanProviders.map(p => (
                      <div key={p.id} style={{ fontSize: 12, color: '#f0f6fc', padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
                        {p.name || p.host}:{p.port} {p.model ? `(${p.model})` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <button
                  className="codex-button codex-button-secondary"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </button>
                <button
                  className="codex-button codex-button-primary"
                  onClick={() => {
                    handleSettingsChange(settings);
                    setShowSettings(false);
                  }}
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

function sessionLabel(repository?: string) {
  const trimmed = repository?.trim() || '';
  if (!trimmed) return 'Untitled workspace';
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}


function summarizeHealth(status: StartupStatus | null) {
  if (!status) return { message: 'Checking Consiglio releases, Codex CLI, and provider interfaces…', color: '#58a6ff', borderColor: 'rgba(88, 166, 255, 0.28)' };
  if (status.appUpdate.updateAvailable) return { message: status.appUpdate.message, color: '#d29922', borderColor: 'rgba(210, 153, 34, 0.36)' };
  const hasError = status.checks.some(check => check.status === 'error');
  if (hasError) return { message: 'Some startup checks need attention before sessions will be reliable.', color: '#f85149', borderColor: 'rgba(248, 81, 73, 0.36)' };
  const hasWarning = status.checks.some(check => check.status === 'warning') || status.appUpdate.status === 'warning';
  if (hasWarning) return { message: 'Consiglio started, but one or more provider/update checks could not be verified.', color: '#d29922', borderColor: 'rgba(210, 153, 34, 0.36)' };
  return { message: 'Consiglio, Codex CLI, and configured provider interfaces look ready.', color: '#3fb950', borderColor: 'rgba(63, 185, 80, 0.36)' };
}

function HealthPill({ label, status, message }: { label: string; status: HealthCheckItem['status'] | UpdateStatus['status']; message: string }) {
  const color = status === 'ok' ? '#3fb950' : status === 'error' ? '#f85149' : status === 'warning' ? '#d29922' : '#58a6ff';
  return (
    <div className="codex-chip" title={message} style={{ maxWidth: 360, borderColor: `${color}66` }}>
      <span className="codex-chip-label" style={{ color }}>{label}</span>
      <span className="codex-chip-value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message}</span>
    </div>
  );
}
