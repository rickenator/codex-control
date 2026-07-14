import { useState, useEffect, useMemo } from 'react';
import SessionList from './features/sessions/SessionList';
import EventTimeline from './features/sessions/EventTimeline';
import FileBrowser from './features/files/FileBrowser';
import SecretsManager from './features/secrets/SecretsManager';

type LanProviderConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
};

type AppSettings = {
  defaultProvider: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
  ollama: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  remoteLlamaCpp: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  lanProviders: LanProviderConfig[];
  defaultModel?: string;
  localProviderBehavior: {
    isolateProfile: boolean;
    enableWebSearch: boolean;
    enableMultiAgent: boolean;
  };
};

type Notice = {
  kind: 'info' | 'success' | 'error';
  message: string;
};

type ApprovalRequest = {
  id: string;
  sessionId: string;
  command: string;
  workingDir: string;
  sandboxPolicy: string;
  affectedPaths: string[];
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
};

const defaultSettings: AppSettings = {
  defaultProvider: 'remote_llamacpp',
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:32b-instruct-q4_K_M',
    apiKey: '',
  },
  remoteLlamaCpp: {
    baseUrl: '',
    model: '',
    apiKey: 'llama.cpp',
  },
  lanProviders: [],
  defaultModel: '',
  localProviderBehavior: {
    isolateProfile: true,
    enableWebSearch: true,
    enableMultiAgent: false,
  },
};

export default function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(() => window.localStorage.getItem('consiglio:selected-session') ?? window.localStorage.getItem('consiglier:selected-session') ?? window.localStorage.getItem('codex-control:selected-session'));
  const [recoveredSessions, setRecoveredSessions] = useState<string[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [providerStatus, setProviderStatus] = useState<Record<string, 'ok' | 'error' | 'checking' | null>>({});
  const [startupStatus, setStartupStatus] = useState<StartupStatus | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lanForm, setLanForm] = useState<{ id: string; name: string; host: string; port: string; model: string; apiKey: string }>({
    id: '', name: '', host: '', port: '8081', model: '', apiKey: '',
  });
  const [discovering, setDiscovering] = useState(false);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [showLanSettings, setShowLanSettings] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  const handleDiscoverLan = async () => {
    setDiscovering(true);
    try {
      const result = await window.codexApi.lanDiscover();
      if (result.error) {
        setNotice({ kind: 'error', message: `LAN discovery failed: ${result.error}` });
      } else if (result.added > 0) {
        setNotice({ kind: 'success', message: `Found ${result.found} servers, added ${result.added} new providers` });
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
      .then(async (loadedSessions) => {
        setSessions(loadedSessions);
        const preferredSession = selectedSession && loadedSessions.some(session => session.id === selectedSession)
          ? selectedSession
          : loadedSessions[0]?.id;
        if (!preferredSession) {
          const created = await window.codexApi.startSession({});
          const updatedSessions = await window.codexApi.listSessions();
          setSessions(updatedSessions);
          setSelectedSession(created.sessionId);
          return;
        }
        setSelectedSession(preferredSession);
        const preferredRecord = loadedSessions.find(session => session.id === preferredSession);
        if (preferredRecord?.status !== 'running') {
          await window.codexApi.reconnectSession(preferredSession);
        }
      })
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
    if (selectedSession) {
      window.localStorage.setItem('consiglio:selected-session', selectedSession);
    } else {
      window.localStorage.removeItem('consiglio:selected-session');
    }
  }, [selectedSession]);

  const activeSession = useMemo(() => sessions.find(session => session.id === selectedSession), [sessions, selectedSession]);
  const [quickProvider, setQuickProvider] = useState<'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama'>(settings.defaultProvider);

  useEffect(() => {
    setQuickProvider(settings.defaultProvider);
  }, [settings.defaultProvider]);

  const handleQuickProviderChange = async (provider: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama') => {
    setQuickProvider(provider);
    const updatedSettings = { ...settings, defaultProvider: provider };
    if (provider === 'ollama') {
      updatedSettings.ollama = settings.ollama || { baseUrl: 'http://localhost:11434', model: 'qwen2.5:32b-instruct-q4_K_M', apiKey: '' };
    }
    await handleSettingsChange(updatedSettings);
  };

  const handleStartSession = async (options: {
    repository?: string;
    branch?: string;
    provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
    selectedLanProviderId?: string;
    lanProvider?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
    remoteLlamaCpp?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
    ollama?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };
    defaultModel?: string;
  }) => {
    try {
      const fullOptions = {
        ...options,
        remoteLlamaCpp: options.remoteLlamaCpp || settings.remoteLlamaCpp,
        ollama: options.ollama || settings.ollama,
        defaultModel: options.defaultModel || settings.defaultModel,
      };
      const result = await window.codexApi.startSession(fullOptions);
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

  const handleStopAllSessions = async () => {
    const runningSessions = sessions.filter(s => s.status === 'running');
    if (runningSessions.length === 0) {
      setNotice({ kind: 'info', message: 'No running sessions to stop.' });
      return;
    }
    let stopped = 0;
    for (const session of runningSessions) {
      try {
        const result = await window.codexApi.stopSession(session.id);
        if (result) stopped++;
      } catch { /* skip failed stops */ }
    }
    const updated = await window.codexApi.listSessions();
    setSessions(updated);
    setNotice({ kind: 'info', message: `Stopped ${stopped} of ${runningSessions.length} session(s).` });
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
      setPendingApprovals(approvals);
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
      setPendingApprovals(approvals);
      setNotice({ kind: 'info', message: 'Approval rejected.' });
    } catch (e) {
      setNotice({ kind: 'error', message: `Could not reject command: ${(e as Error).message}` });
    }
  };

  const handleTestConnection = async (providerType: 'remote_llamacpp' | 'ollama') => {
    setTestingConnection(providerType);
    try {
      const config = providerType === 'remote_llamacpp'
        ? { baseUrl: settings.remoteLlamaCpp.baseUrl, apiKey: settings.remoteLlamaCpp.apiKey || 'llama.cpp', model: settings.remoteLlamaCpp.model }
        : { baseUrl: settings.ollama.baseUrl, apiKey: settings.ollama.apiKey || 'ollama', model: settings.ollama.model };
      const result = await window.codexApi.testRemoteLlamaCpp(config);
      setNotice({
        kind: result.ok ? 'success' : 'error',
        message: `${providerType === 'remote_llamacpp' ? 'Remote llama.cpp' : 'Ollama'}: ${result.message}`,
      });
    } catch (e) {
      setNotice({ kind: 'error', message: `Connection test failed: ${(e as Error).message}` });
    } finally {
      setTestingConnection(null);
    }
  };

  const handleTestProviderConnection = async (provider: {
    baseUrl: string;
    model: string;
    apiKey: string;
    label: string;
  }) => {
    setTestingConnection(provider.label);
    try {
      const result = await window.codexApi.testRemoteLlamaCpp({
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiKey: provider.apiKey || 'llama.cpp',
      });
      setNotice({
        kind: result.ok ? 'success' : 'error',
        message: `${provider.label}: ${result.message}`,
      });
    } catch (e) {
      setNotice({ kind: 'error', message: `Connection test failed: ${(e as Error).message}` });
    } finally {
      setTestingConnection(null);
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
    await handleStartSession({});
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

  // Fetch pending approvals when session changes
  useEffect(() => {
    if (!selectedSession) {
      setPendingApprovals([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const approvals = await window.codexApi.getPendingApprovals(selectedSession);
        if (!cancelled) setPendingApprovals(approvals);
      } catch { /* ignore */ }
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [selectedSession]);

  const healthSummary = summarizeHealth(startupStatus);

  const sandboxColors: Record<string, string> = {
    'danger-full-access': '#f85149',
    'on-request': '#d29922',
    'off': '#3fb950',
    'auto-approve': '#58a6ff',
  };

  return (
    <div className="codex-app-shell">
      {/* Notice Banner */}
      {notice && (
        <div className={`codex-banner ${notice.kind === 'error' ? 'codex-notice-error' : notice.kind === 'success' ? 'codex-notice-success' : 'codex-notice-info'}`}>
          <span style={{ fontSize: 13 }}>{notice.message}</span>
          <button className="codex-button codex-button-secondary" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {/* Recovered Sessions Banner */}
      {recoveredSessions.length > 0 && (
        <div className="codex-banner codex-recovery-banner">
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

      {/* Health Check Banner */}
      <section className="codex-banner codex-health-banner" style={{ alignItems: 'stretch', background: 'rgba(255,255,255,0.035)', borderColor: healthSummary.borderColor }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: healthSummary.color }}>{healthSummary.message}</span>
          {startupStatus && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {startupStatus.checks.map(check => (
                <HealthPill key={check.id} label={check.label} status={check.status} message={check.message} />
              ))}
            </div>
          )}
        </div>
        <button
          className="codex-button codex-button-secondary"
          onClick={handleRefreshStartupStatus}
          disabled={isRefreshingStatus}
          style={{ fontSize: 10, padding: '4px 10px', whiteSpace: 'nowrap' }}
        >
          {isRefreshingStatus ? 'Checking…' : 'Refresh'}
        </button>
      </section>

      {/* Approval Banner — full-width, impossible to miss */}
      {pendingApprovals.length > 0 && (
        <section className="codex-banner codex-approval-banner" style={{
          background: 'rgba(210, 153, 34, 0.12)',
          borderColor: 'rgba(210, 153, 34, 0.4)',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 10,
          padding: '12px 16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#d29922' }}>
              ⏳ {pendingApprovals.length} pending approval{pendingApprovals.length === 1 ? '' : 's'}
            </span>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => setPendingApprovals([])}
              style={{ fontSize: 10, padding: '3px 8px' }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingApprovals.map(approval => (
              <div key={approval.id} style={{
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 10,
                padding: '10px 12px',
                borderLeft: `3px solid ${sandboxColors[approval.sandboxPolicy] || '#8b949e'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                  <code style={{
                    fontSize: 12, color: '#c9d1d9', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {approval.command}
                  </code>
                  <div className="codex-chip" style={{ padding: '2px 6px', fontSize: 9, borderColor: sandboxColors[approval.sandboxPolicy] || '#8b949e', flexShrink: 0 }}>
                    <span className="codex-chip-value" style={{ color: sandboxColors[approval.sandboxPolicy] || '#8b949e' }}>{approval.sandboxPolicy}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    className="codex-button codex-button-primary"
                    onClick={() => handleApprove(approval.id)}
                    style={{ fontSize: 11, padding: '4px 12px' }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    className="codex-button codex-button-danger"
                    onClick={() => handleReject(approval.id)}
                    style={{ fontSize: 11, padding: '4px 12px' }}
                  >
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <section className="codex-panel" style={{ margin: '0 14px 14px', flex: '0 0 auto' }}>
          <div className="codex-panel-header">
            <div className="codex-panel-title">
              <span className="codex-kicker">Settings</span>
              <span className="codex-panel-heading">Local provider behavior</span>
            </div>
          </div>
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.localProviderBehavior.isolateProfile}
                onChange={(event) => void handleSettingsChange({
                  ...settings,
                  localProviderBehavior: { ...settings.localProviderBehavior, isolateProfile: event.target.checked },
                })}
              />
              <span>
                <strong style={{ color: '#f0f6fc' }}>Isolate local-provider sessions</strong>
                <span className="codex-help" style={{ display: 'block', marginTop: 2 }}>
                  Keeps normal Codex MCP servers and profile settings out of llama.cpp/LAN sessions.
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.localProviderBehavior.enableWebSearch}
                onChange={(event) => void handleSettingsChange({
                  ...settings,
                  localProviderBehavior: { ...settings.localProviderBehavior, enableWebSearch: event.target.checked },
                })}
              />
              <span>
                <strong style={{ color: '#f0f6fc' }}>Enable web search</strong>
                <span className="codex-help" style={{ display: 'block', marginTop: 2 }}>
                  Starts local-provider sessions with Codex live web search enabled.
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.localProviderBehavior.enableMultiAgent}
                onChange={(event) => void handleSettingsChange({
                  ...settings,
                  localProviderBehavior: { ...settings.localProviderBehavior, enableMultiAgent: event.target.checked },
                })}
              />
              <span>
                <strong style={{ color: '#f0f6fc' }}>Enable multi-agent</strong>
                <span className="codex-help" style={{ display: 'block', marginTop: 2 }}>
                  Experimental with local providers; enable only when that server handles the required tool schemas.
                </span>
              </span>
            </label>
          </div>
        </section>
      )}

      {/* LAN Providers Settings */}
      {showSettings && (
        <section className="codex-panel" style={{ margin: '0 14px 14px', flex: '0 0 auto' }}>
          <div className="codex-panel-header">
            <div className="codex-panel-title">
              <span className="codex-kicker">Providers</span>
              <span className="codex-panel-heading">Remote & LAN</span>
            </div>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => { setShowSettings(false); setShowLanSettings(true); }}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              Manage
            </button>
          </div>
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            {/* Remote llama.cpp */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 13, color: '#f0f6fc', fontWeight: 600 }}>Remote llama.cpp</label>
                <button
                  className="codex-button codex-button-secondary"
                  onClick={() => handleTestConnection('remote_llamacpp')}
                  disabled={testingConnection !== null}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Test
                </button>
              </div>
              <input
                type="text"
                placeholder="Base URL (e.g., http://192.168.1.243:8081)"
                value={settings.remoteLlamaCpp.baseUrl}
                onChange={(e) => void handleSettingsChange({ ...settings, remoteLlamaCpp: { ...settings.remoteLlamaCpp, baseUrl: e.target.value } })}
                className="codex-input"
              />
              <input
                type="text"
                placeholder="Model"
                value={settings.remoteLlamaCpp.model}
                onChange={(e) => void handleSettingsChange({ ...settings, remoteLlamaCpp: { ...settings.remoteLlamaCpp, model: e.target.value } })}
                className="codex-input"
              />
            </div>

            {/* Ollama */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 13, color: '#f0f6fc', fontWeight: 600 }}>Ollama</label>
                <button
                  className="codex-button codex-button-secondary"
                  onClick={() => handleTestConnection('ollama')}
                  disabled={testingConnection !== null}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Test
                </button>
              </div>
              <input
                type="text"
                placeholder="Base URL (e.g., http://localhost:11434)"
                value={settings.ollama.baseUrl}
                onChange={(e) => void handleSettingsChange({ ...settings, ollama: { ...settings.ollama, baseUrl: e.target.value } })}
                className="codex-input"
              />
              <input
                type="text"
                placeholder="Model"
                value={settings.ollama.model}
                onChange={(e) => void handleSettingsChange({ ...settings, ollama: { ...settings.ollama, model: e.target.value } })}
                className="codex-input"
              />
            </div>

            {/* LAN Providers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {settings.lanProviders.map(p => (
                    <div key={p.id} style={{ fontSize: 12, color: '#f0f6fc', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{p.name || p.host}:{p.port}</span>
                        <button
                          className="codex-button codex-button-secondary"
                          onClick={() => handleTestProviderConnection({
                            baseUrl: p.host.startsWith('http://') || p.host.startsWith('https://') ? p.host : `http://${p.host}:${p.port}`,
                            model: p.model,
                            apiKey: p.apiKey,
                            label: p.name || `${p.host}:${p.port}`,
                          })}
                          disabled={testingConnection !== null}
                          style={{ fontSize: 10, padding: '2px 6px' }}
                          title={`Test ${p.name || p.host}`}
                        >
                          Test
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: '#8b949e' }}>
                        {p.host}:{p.port} {p.model ? `· ${p.model}` : '· no model set'}
                      </div>
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
        </section>
      )}

      {/* Main Content: Sidebar + Single Timeline Panel */}
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

        {/* Single timeline panel — no more 2-column grid */}
        <section className="codex-panel" style={{ flex: 1, minWidth: 0 }}>
          <div className="codex-panel-header">
            <div className="codex-panel-title">
              <span className="codex-panel-heading">
                {activeSession?.repository ? sessionLabel(activeSession.repository) : 'New task'}
              </span>
              <span className="codex-kicker">
                {activeSession ? `${activeSession.branch || 'current branch'} · ${activeSession.model || 'Codex'}` : 'Start a task or choose one from the sidebar'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
              {activeSession?.repository && (
                <button
                  className="codex-button codex-button-secondary"
                  onClick={() => handleOpenPath(activeSession.repository, 'Workspace')}
                >
                  Open folder
                </button>
              )}
              {selectedSession && (
                <button
                  className={`codex-button ${showFiles ? 'codex-button-info' : 'codex-button-secondary'}`}
                  onClick={() => setShowFiles((current) => !current)}
                >
                  Files
                </button>
              )}
              <button
                className="codex-button codex-button-secondary"
                onClick={() => setShowLanSettings(true)}
                title="LAN providers"
              >
                Providers
              </button>
              <button
                className={`codex-button ${showSettings ? 'codex-button-info' : 'codex-button-secondary'}`}
                onClick={() => setShowSettings((current) => !current)}
                title="Task behavior settings"
              >
                Settings
              </button>
              <button
                className="codex-button codex-button-secondary"
                onClick={() => setShowSecrets(true)}
                title="API keys and MCP credentials"
              >
                Secrets
              </button>
              {activeSession?.status === 'running' && selectedSession && (
                <button
                  className="codex-button codex-button-danger"
                  onClick={() => handleStopSession(selectedSession)}
                >
                  Stop
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', position: 'relative' }}>
            <EventTimeline
              sessionId={selectedSession}
              compact
              onCopySessionId={(value) => handleCopyText(value, 'Message')}
              onRequestNewSession={handleRequestNewSession}
              onError={(message) => setNotice({ kind: 'error', message })}
            />
            {showFiles && selectedSession && (
              <FileBrowser
                sessionId={selectedSession}
                onClose={() => setShowFiles(false)}
                onError={(message) => setNotice({ kind: 'error', message })}
              />
            )}
          </div>
        </section>
      </div>

      {/* LAN Settings Modal */}
      <SecretsManager
        open={showSecrets}
        onClose={() => setShowSecrets(false)}
        onNotice={(kind, message) => setNotice({ kind, message })}
      />

      {showLanSettings && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowLanSettings(false)}>
          <div style={{
            background: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
            padding: 24, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#f0f6fc' }}>
                {lanForm.id ? 'Edit LAN Provider' : 'Add LAN Provider'}
              </h3>
              <button
                className="codex-button codex-button-secondary"
                onClick={() => void handleDiscoverLan()}
                disabled={discovering}
              >
                {discovering ? 'Scanning…' : 'Discover LAN'}
              </button>
            </div>
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
                onClick={async () => {
                  try {
                    if (lanForm.id) {
                      await window.codexApi.lanUpdateProvider({
                        id: lanForm.id,
                        name: lanForm.name,
                        host: lanForm.host,
                        port: parseInt(lanForm.port),
                        model: lanForm.model,
                        apiKey: lanForm.apiKey,
                      });
                    } else {
                      await window.codexApi.lanAddProvider({
                        id: `lan-${Date.now()}`,
                        name: lanForm.name,
                        host: lanForm.host,
                        port: parseInt(lanForm.port),
                        model: lanForm.model,
                        apiKey: lanForm.apiKey,
                      });
                    }
                    const updated = await window.codexApi.getSettings();
                    setSettings(updated);
                    setShowLanSettings(false);
                    setNotice({ kind: 'success', message: lanForm.id ? 'Provider updated' : 'Provider added' });
                  } catch (e) {
                    setNotice({ kind: 'error', message: `LAN provider error: ${(e as Error).message}` });
                  }
                }}
              >
                {lanForm.id ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
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
