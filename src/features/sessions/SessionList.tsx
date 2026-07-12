import React, { useEffect, useMemo, useRef, useState } from 'react';
const commonModels = [
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'gpt-4', name: 'GPT-4' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus' },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet' },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku' },
  { id: 'gemini-pro', name: 'Gemini Pro' },
  { id: 'llama-3.1-70b', name: 'Llama 3.1 70B' },
];

const gptModels = [
  { id: 'gpt-5.6', name: 'GPT-5.6' },
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'gpt-4', name: 'GPT-4' },
];

interface Session {
  id: string;
  repository?: string;
  branch?: string;
  status: string;
  updated_at: number;
  provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
  model?: string;
  baseUrl?: string;
}

type NewSessionOptions = {
  repository?: string;
  branch?: string;
  provider?: 'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama';
  model?: string;
  baseUrl?: string;
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
  selectedLanProviderId?: string;
  defaultModel?: string;
};

type LanProviderConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  apiKey: string;
};
interface Props {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
  onStartSession: (options: NewSessionOptions) => void;
  onReconnect: (sessionId: string) => void;
  onPickRepository: () => Promise<string | null>;
  onCopyPath: (path: string, label: string) => void;
  onOpenPath: (path: string, label: string) => void;
  onTestRemote: (config: { baseUrl: string; model: string; apiKey: string }) => Promise<boolean>;
  onRequestNewSession: () => Promise<void>;
  onStopSession: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
  settings: {
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
  };
  onSettingsChange: (settings: {
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
  }) => void;
}

const statusColor: Record<string, string> = {
  idle: '#8b949e',
  running: '#58a6ff',
  awaiting_approval: '#d29922',
  paused: '#8b949e',
  failed: '#f85149',
  completed: '#3fb950',
  stopped: '#484f58',
};

export default function SessionList({ sessions, selected, onSelect, onStartSession, onReconnect, onPickRepository, onCopyPath, onOpenPath, onTestRemote, onRequestNewSession, onStopSession, onDeleteSession, settings, onSettingsChange }: Props) {
  const [showNewSession, setShowNewSession] = useState(false);
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('');
  const [provider, setProvider] = useState<'default' | 'remote_llamacpp' | 'gpt56' | 'lan' | 'ollama'>(settings.defaultProvider);
  const [baseUrl, setBaseUrl] = useState(settings.remoteLlamaCpp.baseUrl);
  const [model, setModel] = useState(settings.remoteLlamaCpp.model);
  const [apiKey, setApiKey] = useState(settings.remoteLlamaCpp.apiKey);
  const [selectedLanProviderId, setSelectedLanProviderId] = useState(() => settings.lanProviders[0]?.id || '');
  const [defaultProviderModel, setDefaultProviderModel] = useState(settings.defaultModel || settings.remoteLlamaCpp.model);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name?: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const selectedLanProvider = useMemo(
    () => settings.lanProviders.find((lanProvider) => lanProvider.id === selectedLanProviderId) || settings.lanProviders[0] || null,
    [selectedLanProviderId, settings.lanProviders],
  );
  const selectedLanBaseUrl = selectedLanProvider ? `${selectedLanProvider.host}:${selectedLanProvider.port}` : '';

  const refreshModels = async () => {
    if (provider !== 'remote_llamacpp' && provider !== 'lan') return;
    const url = provider === 'lan' ? selectedLanBaseUrl : baseUrl.trim();
    if (!url) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const models = await window.codexApi.fetchModels({ baseUrl: url, apiKey: apiKey || undefined });
      setAvailableModels(models);
      if (models.length > 0 && !model.trim()) {
        setModel(models[0].id);
      }
    } catch (e) {
      setModelsError((e as Error).message || 'Failed to fetch models');
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  };
  const [search, setSearch] = useState('');
  const [isDroppingWorkspace, setIsDroppingWorkspace] = useState(false);
  useEffect(() => {
    if (provider !== 'remote_llamacpp' && provider !== 'lan') {
      setAvailableModels([]);
      setModelsError(null);
      return;
    }
    // Auto-fetch models when provider changes and we have a URL
    const url = provider === 'lan' ? selectedLanBaseUrl : baseUrl.trim();
    if (!url) {
      setAvailableModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    window.codexApi.fetchModels({ baseUrl: url, apiKey: apiKey || undefined })
      .then((models: Array<{ id: string; name?: string }>) => {
        if (!cancelled) {
          setAvailableModels(models);
          if (models.length > 0 && !model.trim()) {
            setModel(models[0].id);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [baseUrl, apiKey, provider, selectedLanBaseUrl]);

  // Reset model state when switching away from providers that use /v1/models
  useEffect(() => {
    if (provider !== 'remote_llamacpp' && provider !== 'lan') {
      setAvailableModels([]);
      setModelsError(null);
    }
  }, [provider]);

  const searchRef = useRef<HTMLInputElement>(null);
  const repositoryRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const recentWorkspaces = useMemo(() => {
    const latestByRepo = new Map<string, number>();
    for (const session of sessions) {
      const repository = session.repository?.trim();
      if (!repository) continue;
      const updatedAt = session.updated_at || 0;
      const current = latestByRepo.get(repository);
      if (current == null || updatedAt > current) {
        latestByRepo.set(repository, updatedAt);
      }
    }
    return [...latestByRepo.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([repository]) => repository);
  }, [sessions]);

  const remoteProfileReady = Boolean(baseUrl.trim() && model.trim());
  const lanProfileReady = provider !== 'lan' || Boolean(selectedLanProvider);
  const canLaunchRemote = provider !== 'remote_llamacpp' || remoteProfileReady;

  const launchSession = async () => {
    let nextRepository = repository.trim();
    if (!nextRepository) {
      const pickedRepository = await onPickRepository();
      if (!pickedRepository) {
        return;
      }
      nextRepository = pickedRepository;
      setRepository(pickedRepository);
      setShowNewSession(true);
    }

    if (provider === 'remote_llamacpp' && (!baseUrl.trim() || !model.trim())) {
      return;
    }

    if (provider === 'lan' && !selectedLanProvider) {
      return;
    }

    onStartSession({
      repository: nextRepository || undefined,
      branch: branch.trim() || undefined,
      provider,
      remoteLlamaCpp: provider === 'remote_llamacpp' ? {
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      } : undefined,
      ollama: provider === 'ollama' ? {
        baseUrl: settings.ollama.baseUrl,
        model: model.trim() || settings.ollama.model || undefined,
        apiKey: settings.ollama.apiKey || undefined,
      } : undefined,
      defaultModel: provider === 'default' ? (defaultProviderModel.trim() || undefined) : undefined,
      selectedLanProviderId: provider === 'lan' ? selectedLanProviderId || undefined : undefined,
    });
    onSettingsChange({
      defaultProvider: provider,
      ollama: { baseUrl: settings.ollama.baseUrl, model: settings.ollama.model, apiKey: settings.ollama.apiKey },
      remoteLlamaCpp: { baseUrl, model, apiKey },
      defaultModel: provider === 'default' ? (defaultProviderModel.trim() || undefined) : (settings.defaultModel || undefined),
      lanProviders: settings.lanProviders || [],
    });
    setRepository('');
    setBranch('');
    setShowNewSession(false);
  };

  useEffect(() => {
    setProvider(settings.defaultProvider);
    setBaseUrl(settings.remoteLlamaCpp.baseUrl);
    setModel(settings.remoteLlamaCpp.model);
    setApiKey(settings.remoteLlamaCpp.apiKey);
    setDefaultProviderModel(settings.defaultModel || settings.remoteLlamaCpp.model);
    setSelectedLanProviderId((currentId) => {
      if (settings.lanProviders.some((lanProvider) => lanProvider.id === currentId)) {
        return currentId;
      }
      return settings.lanProviders[0]?.id || '';
    });
  }, [settings.defaultProvider, settings.remoteLlamaCpp.baseUrl, settings.remoteLlamaCpp.model, settings.remoteLlamaCpp.apiKey, settings.defaultModel, settings.lanProviders]);

  // Reset provider-specific fields when provider changes
  useEffect(() => {
    if (provider === 'remote_llamacpp') {
      setBaseUrl(settings.remoteLlamaCpp.baseUrl);
      setModel(settings.remoteLlamaCpp.model);
      setApiKey(settings.remoteLlamaCpp.apiKey);
    } else if (provider === 'ollama') {
      setModel(settings.ollama.model);
      setApiKey(settings.ollama.apiKey);
    } else if (provider === 'default') {
      setDefaultProviderModel(settings.defaultModel || settings.remoteLlamaCpp.model);
    } else if (provider === 'gpt56') {
      setModel('gpt-5.6');
    } else if (provider === 'lan') {
      const firstLan = settings.lanProviders[0];
      if (firstLan) {
        setSelectedLanProviderId(firstLan.id);
        setModel(firstLan.model || '');
      }
    }
  }, [provider, settings.remoteLlamaCpp, settings.ollama, settings.defaultModel, settings.lanProviders]);

  useEffect(() => {
    const unsubscribe = window.codexApi.onNewSession(() => {
      setShowNewSession(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (showNewSession) {
      queueMicrotask(() => repositoryRef.current?.focus());
    }
  }, [showNewSession]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (event.key === 'Enter' && showNewSession) {
        event.preventDefault();
        void launchSession();
      }
      if (event.key === 'Escape' && showNewSession) {
        setShowNewSession(false);
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [provider, baseUrl, model, apiKey, repository, branch, selectedLanProvider, selectedLanProviderId, onStartSession, onPickRepository, onSettingsChange]);

  const filteredSessions = sessions.filter(session => {
    const haystack = [
      session.repository,
      session.branch,
      session.status,
      session.provider,
      session.model,
      session.baseUrl,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDroppingWorkspace(false);
    const droppedPath = event.dataTransfer.files[0]?.path;
    if (droppedPath) {
      setRepository(droppedPath);
      setShowNewSession(true);
    }
  };

  return (
    <aside className="codex-sidebar">
      <div style={{ padding: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f0f6fc' }}>Sessions</h3>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>Workspaces, launch profiles, and live sessions</div>
          </div>
          <button
            className="codex-button codex-button-info"
            onClick={() => setShowNewSession(!showNewSession)}
            aria-expanded={showNewSession}
            aria-controls="new-session-form"
          >
            {showNewSession ? 'Close' : '+ New'}
          </button>
        </div>

        <div className="codex-form-card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: '#f0f6fc', fontWeight: 600 }}>Launch profile</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                Saved default: {settings.defaultProvider === 'remote_llamacpp' ? 'Remote llama.cpp' : settings.defaultProvider === 'ollama' ? 'Ollama' : settings.defaultProvider === 'gpt56' ? 'GPT-5.6' : settings.defaultProvider === 'lan' ? 'LAN Provider' : 'Default Codex'}
              </span>
            </div>
            <div className="codex-chip" style={{ padding: '4px 8px' }}>
              <span className="codex-chip-label">Mode</span>
              <span className="codex-chip-value">{provider === 'remote_llamacpp' ? 'Remote llama.cpp' : provider === 'ollama' ? 'Ollama' : provider === 'gpt56' ? 'GPT-5.6' : provider === 'lan' ? 'LAN Provider' : 'Default Codex'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <button
              className="codex-button codex-button-primary"
              aria-label="Save default launch profile"
              onClick={() => onSettingsChange({
                defaultProvider: provider,
                ollama: { baseUrl: settings.ollama.baseUrl, model: settings.ollama.model, apiKey: settings.ollama.apiKey },
                remoteLlamaCpp: { baseUrl, model, apiKey },
                lanProviders: settings.lanProviders || [],
              })}
            >
              Save as default
            </button>
            <button
              className="codex-button codex-button-secondary"
              onClick={async () => {
                await onTestRemote({ baseUrl, model, apiKey });
              }}
              disabled={provider === 'remote_llamacpp' && !remoteProfileReady}
            >
              Test connection
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <MiniRow label="Endpoint" value={provider === 'lan' ? selectedLanBaseUrl || 'No LAN providers configured' : baseUrl} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ color: '#8b949e', minWidth: 40 }}>Model</span>
              {provider === 'remote_llamacpp' && (
                modelsLoading ? (
                  <span style={{ color: '#58a6ff' }}>Fetching...</span>
                ) : availableModels.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="codex-select"
                    style={{ flex: 1, fontSize: 11, padding: '2px 4px', background: '#0d1117', color: '#f0f6fc', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }}
                  >
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="codex-input"
                    style={{ flex: 1, fontSize: 11, padding: '2px 4px' }}
                    placeholder="Enter model name"
                  />
                )
              )}
              {provider === 'lan' && (
                modelsLoading ? (
                  <span style={{ color: '#58a6ff' }}>Fetching...</span>
                ) : availableModels.length > 0 ? (
                  <select
                    value={selectedLanProvider?.model || ''}
                    onChange={(e) => {
                      if (selectedLanProvider) {
                        const updated = { ...selectedLanProvider, model: e.target.value };
                        window.codexApi.lanUpdateProvider(updated);
                        onSettingsChange({ ...settings, lanProviders: settings.lanProviders.map(p => p.id === updated.id ? updated : p) });
                      }
                    }}
                    className="codex-select"
                    style={{ flex: 1, fontSize: 11, padding: '2px 4px', background: '#0d1117', color: '#f0f6fc', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }}
                  >
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ color: '#8b949e' }}>{selectedLanProvider?.model || 'No model set'}</span>
                )
              )}
              {provider === 'default' && (
                <select
                  value={defaultProviderModel}
                  onChange={(e) => setDefaultProviderModel(e.target.value)}
                  className="codex-select"
                  style={{ flex: 1, fontSize: 11, padding: '2px 4px', background: '#0d1117', color: '#f0f6fc', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }}
                >
                  <option value="">Use Codex default</option>
                  {commonModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  {defaultProviderModel && !commonModels.some(m => m.id === defaultProviderModel) && (
                    <option value={defaultProviderModel}>{defaultProviderModel}</option>
                  )}
                </select>
              )}
              {provider === 'gpt56' && (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="codex-select"
                  style={{ flex: 1, fontSize: 11, padding: '2px 4px', background: '#0d1117', color: '#f0f6fc', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }}
                >
                  {gptModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  {model && !gptModels.some(m => m.id === model) && (
                    <option value={model}>{model}</option>
                  )}
                </select>
              )}
              {(provider === 'remote_llamacpp' || provider === 'lan') && (
                <button
                  onClick={() => refreshModels()}
                  disabled={modelsLoading}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 4,
                    color: modelsLoading ? '#8b949e' : '#58a6ff',
                    cursor: modelsLoading ? 'wait' : 'pointer',
                    padding: '2px 6px',
                    fontSize: 11,
                    flexShrink: 0,
                  }}
                  title="Refresh model list"
                >
                  {modelsLoading ? '⟳' : '↻'}
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => {
                setProvider('remote_llamacpp');
                setBaseUrl(settings.remoteLlamaCpp.baseUrl);
                setModel('unsloth/Qwen3.6-35B-A3B-GGUF');
                setApiKey('llama.cpp');
              }}
            >
              Reset local draft
            </button>
            <span className="codex-help" style={{ alignSelf: 'center' }}>
              Launch uses this draft; save it to change the default.
            </span>
          </div>
        </div>

        {showNewSession && (
          <div
            className={`codex-form-card codex-drop-zone${isDroppingWorkspace ? ' codex-drop-zone-active' : ''}`}
            id="new-session-form"
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepthRef.current += 1;
              setIsDroppingWorkspace(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'copy';
              setIsDroppingWorkspace(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) {
                setIsDroppingWorkspace(false);
              }
            }}
            onDrop={handleDrop}
          >
            <div className="codex-help" style={{ marginBottom: 8 }}>
              {isDroppingWorkspace ? 'Drop the workspace folder to start a session.' : 'Drop a workspace folder here or use the buttons below.'}
            </div>
            <input
              ref={repositoryRef}
              type="text"
              placeholder="Repository path"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              className="codex-input"
              style={{ marginBottom: 4 }}
            />
            <input
              type="text"
              placeholder="Branch (optional)"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              className="codex-input"
              style={{ marginBottom: 8 }}
            />
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#8b949e' }}>Provider</label>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'default' | 'remote_llamacpp' | 'gpt56' | 'lan')}
              className="codex-select"
              style={{ marginBottom: 8 }}
            >
              <option value="remote_llamacpp">Remote llama.cpp</option>
              <option value="ollama">Ollama (local)</option>
              <option value="default">Default Codex</option>
              <option value="gpt56">GPT-5.6</option>
              <option value="lan">LAN Provider</option>
            </select>
                        {provider === 'ollama' && (
              <>
                <input
                  type="text"
                  placeholder="Ollama base URL"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="codex-input"
                  style={{ marginBottom: 4 }}
                />
                {modelsLoading ? (
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Fetching models...</div>
                ) : availableModels.length > 0 ? (
                  <select
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="codex-select"
                    style={{ marginBottom: 4 }}
                  >
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Model name (or fetch from /v1/models)"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="codex-input"
                    style={{ marginBottom: 4 }}
                  />
                )}
              </>
            )}
            {provider === 'lan' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#8b949e' }}>LAN provider:</span>
                <select
                  value={selectedLanProviderId}
                  onChange={(event) => setSelectedLanProviderId(event.target.value)}
                  className="codex-select"
                  style={{ flex: 1 }}
                  disabled={settings.lanProviders.length === 0}
                >
                  {settings.lanProviders.length === 0 ? (
                    <option value="">No LAN providers configured</option>
                  ) : settings.lanProviders.map((lanProvider) => (
                    <option key={lanProvider.id} value={lanProvider.id}>{lanProvider.name}</option>
                  ))}
                </select>
              </div>
            )}
            {provider === 'remote_llamacpp' && (
              <>
                <input
                  type="text"
                  placeholder="llama.cpp base URL"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="codex-input"
                  style={{ marginBottom: 4 }}
                />
                {modelsLoading ? (
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Fetching models...</div>
                ) : availableModels.length > 0 ? (
                  <select
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="codex-select"
                    style={{ marginBottom: 4 }}
                  >
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Model name (or fetch from /v1/models)"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="codex-input"
                    style={{ marginBottom: 4 }}
                  />
                )}
                <input
                  type="password"
                  placeholder="API key (optional)"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="codex-input"
                  style={{ marginBottom: 8 }}
                />
              </>
            )}
            <button
              className="codex-button codex-button-secondary"
              disabled={(provider === 'remote_llamacpp' && !canLaunchRemote) || !lanProfileReady}
              onClick={() => void launchSession()}
              style={{
                width: '100%',
                background: (provider === 'remote_llamacpp' && !canLaunchRemote) || !lanProfileReady ? 'rgba(255,255,255,0.06)' : 'rgba(35, 134, 54, 0.88)',
                color: '#fff',
                cursor: (provider === 'remote_llamacpp' && !canLaunchRemote) || !lanProfileReady ? 'not-allowed' : 'pointer',
              }}
            >
              Start Session
            </button>
            <button
              className="codex-button codex-button-secondary"
              onClick={async () => {
                const folder = await onPickRepository();
                if (folder) {
                  setRepository(folder);
                  setShowNewSession(true);
                }
              }}
              style={{ width: '100%', marginTop: 8 }}
            >
              Browse workspace…
            </button>
            {provider === 'remote_llamacpp' && !remoteProfileReady && (
              <div className="codex-help" style={{ marginTop: 4 }}>
                Base URL and model are required for remote launches.
              </div>
            )}
            {provider === 'lan' && !selectedLanProvider && (
              <div className="codex-help" style={{ marginTop: 4 }}>
                Configure a LAN provider before launching.
              </div>
            )}
            {recentWorkspaces.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="codex-help" style={{ marginBottom: 8 }}>Recent workspaces</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentWorkspaces.map((workspace) => (
                    <button
                      key={workspace}
                      className="codex-button codex-button-secondary"
                      onClick={() => {
                        setRepository(workspace);
                        setShowNewSession(true);
                      }}
                      style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {workspace}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="codex-help" style={{ marginTop: 8 }}>
              Tip: Ctrl/Cmd+Enter submits, Esc closes the form, Ctrl/Cmd+L focuses search.
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '0 14px 10px' }}>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search sessions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="codex-search"
        />
      </div>

      <div className="codex-list">
        {search.trim() && filteredSessions.length === 0 && (
          <div className="codex-empty-state" style={{ paddingTop: 16, paddingBottom: 16 }}>
            No sessions match “{search.trim()}”.
          </div>
        )}
        {sessions.length === 0 && !showNewSession && (
          <div className="codex-empty-state" style={{ paddingTop: 20, paddingBottom: 20 }}>
            No sessions yet. Click "+ New" to start a session.
            <div style={{ marginTop: 10 }}>
              <button
                className="codex-button codex-button-primary"
                onClick={() => void onRequestNewSession()}
              >
                Open new session drawer
              </button>
            </div>
          </div>
        )}
        {(search.trim() ? filteredSessions : sessions).map(s => {
          const workspaceLabel = sessionLabel(s.repository);
          const workspacePath = s.repository?.trim() || '';
          return (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`codex-list-item ${selected === s.id ? 'codex-list-item-active' : ''}`}
            style={{ borderLeftColor: statusColor[s.status] || '#8b949e' }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(s.id);
              }
            }}
            aria-pressed={selected === s.id}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="codex-list-item-title" title={workspacePath || 'Untitled'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.status === 'running' && (
                    <span style={{ 
                      display: 'inline-block', 
                      width: 6, 
                      height: 6, 
                      borderRadius: '50%', 
                      background: '#58a6ff',
                      boxShadow: '0 0 6px rgba(88, 166, 255, 0.6)',
                      animation: 'pulse 2s ease-in-out infinite'
                    }} />
                  )}
                  {workspaceLabel}
                </div>
                <div className="codex-list-item-subtitle" style={{ marginTop: 5 }}>
                  {workspacePath ? (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {workspacePath}
                    </span>
                  ) : (
                    <span>Unnamed workspace</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {workspacePath && (
                  <>
                    <button
                      className="codex-button codex-button-secondary"
                      aria-label={`Copy path for ${workspaceLabel}`}
                      title="Copy path"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopyPath(workspacePath, 'Workspace path');
                      }}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      Copy
                    </button>
                    <button
                      className="codex-button codex-button-secondary"
                      aria-label={`Open ${workspaceLabel}`}
                      title="Open folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPath(workspacePath, 'Workspace');
                      }}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      Open
                    </button>
                  </>
                )}
                {s.status === 'running' && (
                  <button
                    className="codex-button codex-button-secondary"
                    aria-label={`Stop session for ${workspaceLabel}`}
                    title="Stop session"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStopSession(s.id);
                    }}
                    style={{ padding: '4px 10px', color: '#f85149' }}
                  >
                    Stop
                  </button>
                )}
                {(s.status === 'completed' || s.status === 'stopped') && (
                  <button
                    className="codex-button codex-button-secondary"
                    aria-label={`Delete session for ${workspaceLabel}`}
                    title="Delete session"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    style={{ padding: '4px 10px', color: '#f85149' }}
                  >
                    Delete
                  </button>
                )}
                {s.status === 'failed' && (
                  <button
                    className="codex-button codex-button-secondary"
                    aria-label={`Retry session for ${s.repository || 'untitled workspace'}`}
                    title="Retry session"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReconnect(s.id);
                    }}
                    style={{ padding: '4px 10px', color: '#58a6ff' }}
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
            <div className="codex-list-item-subtitle">
              <span>{s.branch || 'no branch'}</span>
              <span>·</span>
              <span>{s.status}</span>
              {s.provider && (
                <>
                  <span>·</span>
                  <span>{s.provider === 'remote_llamacpp' ? 'llama.cpp' : s.provider === 'gpt56' ? 'GPT-5.6' : s.provider === 'lan' ? 'LAN' : 'default'}</span>
                </>
              )}
              <span>·</span>
              <span>{formatUpdatedAt(s.updated_at)}</span>
            </div>
          </div>
        );})}
      </div>
    </aside>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11 }}>
      <span style={{ color: '#8b949e' }}>{label}</span>
      <span style={{ color: '#f0f6fc', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

function formatUpdatedAt(updatedAt: number) {
  const delta = Date.now() - updatedAt;
  const minutes = Math.max(1, Math.round(delta / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function sessionLabel(repository?: string) {
  const trimmed = repository?.trim() || '';
  if (!trimmed) return 'Untitled workspace';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}
