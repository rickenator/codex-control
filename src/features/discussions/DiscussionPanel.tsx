import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiscussionMessage } from '@/main/discussion-session';

interface Props {
  onError?: (message: string) => void;
}

interface AgentVisual {
  id: AgentId;
  fallbackName: string;
  color: string;
  icon: string;
}

interface AgentDescriptor extends AgentReadiness {
  color: string;
  icon: string;
}

interface ActiveDiscussion {
  sessionId: string;
  agents: string[];
  history: DiscussionMessage[];
}

const AGENT_VISUALS: AgentVisual[] = [
  { id: 'codex', fallbackName: 'Codex', color: '#10b981', icon: '⚡' },
  { id: 'open-interpreter', fallbackName: 'Open Interpreter', color: '#3b82f6', icon: '🐍' },
  { id: 'aider', fallbackName: 'Aider', color: '#f59e0b', icon: '🔧' },
  { id: 'claude-code', fallbackName: 'Claude Code', color: '#8b5cf6', icon: '◆' },
];

const AGENT_VISUAL_MAP = new Map(AGENT_VISUALS.map(agent => [agent.id, agent]));
const WORKSPACE_STORAGE_KEY = 'consiglio:discussion-workspace';

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '').replace(/\r\n/g, '\n');
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;

  for (const segment of text.split(/(`[^`]+`)/g)) {
    if (segment.startsWith('`') && segment.endsWith('`')) {
      parts.push(
        <code key={`code-${key++}`} className="discussion-inline-code">
          {segment.slice(1, -1)}
        </code>,
      );
      continue;
    }

    for (const boldPart of segment.split(/(\*\*[^*]+\*\*)/g)) {
      if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
        parts.push(<strong key={`bold-${key++}`}>{boldPart.slice(2, -2)}</strong>);
      } else if (boldPart) {
        parts.push(<React.Fragment key={`text-${key++}`}>{boldPart}</React.Fragment>);
      }
    }
  }

  return parts;
}

function renderMarkdown(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  const codeLines: string[] = [];
  let inCodeBlock = false;
  let key = 0;

  const flushCode = () => {
    if (codeLines.length === 0) return;
    elements.push(
      <pre key={`block-${key++}`} className="discussion-code-block">
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
    codeLines.length = 0;
  };

  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) flushCode();
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      elements.push(<br key={`break-${key++}`} />);
    } else if (line.startsWith('### ')) {
      elements.push(<h4 key={`heading-${key++}`}>{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={`heading-${key++}`}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={`heading-${key++}`}>{renderInline(line.slice(2))}</h2>);
    } else {
      elements.push(<p key={`paragraph-${key++}`}>{renderInline(line)}</p>);
    }
  }

  flushCode();
  return elements;
}

function mergeMessages(
  current: DiscussionMessage[],
  incoming: DiscussionMessage | DiscussionMessage[],
): DiscussionMessage[] {
  const merged = new Map(current.map(message => [message.id, message]));
  const additions = Array.isArray(incoming) ? incoming : [incoming];
  for (const message of additions) merged.set(message.id, message);

  return [...merged.values()].sort((left, right) =>
    left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

function MessageBubble({ message }: { message: DiscussionMessage }) {
  const agent = message.agentId ? AGENT_VISUAL_MAP.get(message.agentId as AgentId) : undefined;
  const isUser = message.role === 'user';
  const isSynthesis = message.role === 'synthesis';
  const accent = agent?.color || '#64748b';
  const label = isUser
    ? 'You'
    : isSynthesis
      ? `${agent?.fallbackName || 'Agent'} · synthesis`
      : agent?.fallbackName || 'Agent';
  const avatar = isUser ? 'You' : agent?.icon || 'AI';

  return (
    <div
      className="discussion-message-bubble"
      style={{
        background: isUser ? '#1e293b' : `${accent}10`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 12,
      }}
    >
      <div
        className="discussion-message-header"
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <span
          style={{
            minWidth: 28,
            height: 24,
            padding: '0 6px',
            borderRadius: 12,
            background: accent,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: '#fff',
          }}
        >
          {avatar}
        </span>
        <strong style={{ flex: 1, color: accent, fontSize: 13 }}>{label}</strong>
        <span style={{ color: '#64748b', fontSize: 11 }}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div
        className="discussion-message-content"
        style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
      >
        {renderMarkdown(stripAnsi(message.content))}
      </div>
    </div>
  );
}

function fallbackReadiness(visual: AgentVisual, diagnostic: string): AgentDescriptor {
  return {
    id: visual.id,
    name: visual.fallbackName,
    installed: false,
    authenticated: false,
    configuration: 'required',
    selectable: false,
    state: 'error',
    diagnostic,
    supportTier: visual.id === 'codex' ? 'supported' : 'preview',
    checkedAt: Date.now(),
    color: visual.color,
    icon: visual.icon,
  };
}

function readinessLabel(agent: AgentDescriptor): string {
  if (agent.state === 'ready') {
    return agent.configuration === 'unknown' ? 'Detected' : 'Ready';
  }
  if (agent.state === 'configuration-required') return 'Sign-in required';
  if (agent.state === 'missing') return 'Not installed';
  if (agent.state === 'timeout') return 'Timed out';
  return 'Check failed';
}

export default function DiscussionPanel({ onError }: Props) {
  const [activeDiscussion, setActiveDiscussion] = useState<ActiveDiscussion | null>(null);
  const [input, setInput] = useState('');
  const [workspace, setWorkspace] = useState(() => window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || '');
  const [availableAgents, setAvailableAgents] = useState<AgentDescriptor[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [agentLoadError, setAgentLoadError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedAgents = useMemo(
    () => availableAgents.filter(agent => agent.selectable && selectedAgentIds.includes(agent.id)),
    [availableAgents, selectedAgentIds],
  );

  const loadAgentReadiness = useCallback(async () => {
    setIsLoadingAgents(true);
    setAgentLoadError('');
    try {
      const detected = await window.codexApi.getAvailableAgents();
      const detectedById = new Map(detected.map(agent => [agent.id, agent]));
      const descriptors = AGENT_VISUALS.map(visual => {
        const readiness = detectedById.get(visual.id);
        return readiness
          ? { ...readiness, color: visual.color, icon: visual.icon }
          : fallbackReadiness(visual, `${visual.fallbackName} did not return a readiness result.`);
      });

      setAvailableAgents(descriptors);
      setSelectedAgentIds(current => {
        const selectableIds = new Set(descriptors.filter(agent => agent.selectable).map(agent => agent.id));
        const retained = current.filter(id => selectableIds.has(id as AgentId));
        if (retained.length > 0) return retained;
        return descriptors.filter(agent => agent.selectable).slice(0, 2).map(agent => agent.id);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentLoadError(message);
      setAvailableAgents(AGENT_VISUALS.map(visual => fallbackReadiness(
        visual,
        `Readiness detection failed: ${message}`,
      )));
      setSelectedAgentIds([]);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDiscussion?.history]);

  useEffect(() => {
    void loadAgentReadiness();
  }, [loadAgentReadiness]);

  useEffect(() => {
    if (workspace) return;

    window.codexApi.listSessions().then(sessions => {
      const mostRecent = [...sessions].sort((left, right) => right.updated_at - left.updated_at)[0];
      if (!mostRecent?.repository) return;
      setWorkspace(mostRecent.repository);
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, mostRecent.repository);
    }).catch(() => {});
  }, [workspace]);

  useEffect(() => {
    const sessionId = activeDiscussion?.sessionId;
    if (!sessionId) return;

    const unsubscribeMessage = window.codexApi.onDiscussionMessage(data => {
      if (data.sessionId !== sessionId) return;
      setActiveDiscussion(current => current && current.sessionId === sessionId
        ? { ...current, history: mergeMessages(current.history, data.message) }
        : current);
    });

    const unsubscribeError = window.codexApi.onDiscussionError(data => {
      if (data.sessionId === sessionId) onError?.(`Discussion error: ${data.error}`);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeError();
    };
  }, [activeDiscussion?.sessionId, onError]);

  const chooseWorkspace = async () => {
    if (isPickingWorkspace) return;
    setIsPickingWorkspace(true);
    try {
      const selected = await window.codexApi.pickFolder();
      if (!selected) return;
      setWorkspace(selected);
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, selected);
    } catch (error) {
      onError?.(`Could not choose workspace: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsPickingWorkspace(false);
    }
  };

  const createDiscussion = async () => {
    if (!workspace) {
      onError?.('Choose a workspace before starting a discussion.');
      return;
    }
    if (selectedAgents.length === 0 || isCreating) return;

    const synthesisAgent = selectedAgents.find(agent =>
      agent.id === 'codex' || agent.id === 'open-interpreter')?.id;

    setIsCreating(true);
    try {
      const result = await window.codexApi.startDiscussion({
        repository: workspace,
        agents: selectedAgents.map(agent => ({ id: agent.id })),
        maxTurns: selectedAgents.length,
        moderatorStrategy: 'context-aware',
        synthesisAgent: selectedAgents.length > 1 ? synthesisAgent : undefined,
      });

      setActiveDiscussion({
        sessionId: result.sessionId,
        agents: result.agents,
        history: result.history || [],
      });
    } catch (error) {
      onError?.(`Failed to start discussion: ${error instanceof Error ? error.message : String(error)}`);
      void loadAgentReadiness();
    } finally {
      setIsCreating(false);
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!activeDiscussion || !content || isSending) return;

    setIsSending(true);
    setInput('');
    try {
      const history = await window.codexApi.sendDiscussionMessage(activeDiscussion.sessionId, content);
      setActiveDiscussion(current => current ? {
        ...current,
        history: mergeMessages(current.history, history),
      } : null);
    } catch (error) {
      setInput(content);
      onError?.(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSending(false);
    }
  };

  const stopDiscussion = async () => {
    if (!activeDiscussion) return;
    try {
      await window.codexApi.stopDiscussion(activeDiscussion.sessionId);
      setActiveDiscussion(null);
    } catch (error) {
      onError?.(`Failed to stop discussion: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleAgent = (agent: AgentDescriptor) => {
    if (!agent.selectable) return;
    setSelectedAgentIds(current => current.includes(agent.id)
      ? current.filter(id => id !== agent.id)
      : [...current, agent.id]);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void sendMessage();
  };

  if (!activeDiscussion) {
    const canStart = Boolean(workspace)
      && selectedAgents.length > 0
      && !isCreating
      && !isLoadingAgents;
    const lastChecked = availableAgents[0]?.checkedAt;

    return (
      <div className="discussion-setup" style={{ padding: 20, overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#e2e8f0' }}>Multi-Agent Discussion</h2>
        <p style={{ margin: '0 0 20px', color: '#94a3b8', fontSize: 13 }}>
          Give each selected agent one turn, then synthesize with Codex or Open Interpreter when available.
        </p>

        <div style={{ marginBottom: 18 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Workspace</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              title={workspace || 'No workspace selected'}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '9px 12px',
                border: '1px solid #334155',
                borderRadius: 8,
                color: workspace ? '#e2e8f0' : '#64748b',
                background: '#0d1117',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
              }}
            >
              {workspace || 'Choose the repository or working directory for these agents'}
            </div>
            <button className="codex-button codex-button-secondary" onClick={chooseWorkspace} disabled={isPickingWorkspace}>
              {isPickingWorkspace ? 'Choosing…' : 'Choose…'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Agents</div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
              {isLoadingAgents
                ? 'Checking installed CLIs…'
                : lastChecked
                  ? `Checked ${new Date(lastChecked).toLocaleTimeString()}`
                  : 'Readiness not checked'}
            </div>
          </div>
          <button
            className="codex-button codex-button-secondary"
            onClick={() => void loadAgentReadiness()}
            disabled={isLoadingAgents}
          >
            {isLoadingAgents ? 'Checking…' : 'Refresh'}
          </button>
        </div>

        {agentLoadError && (
          <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>
            Agent detection failed: {agentLoadError}
          </div>
        )}

        <div
          className="agent-selection"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 20 }}
        >
          {availableAgents.map(agent => {
            const selected = selectedAgentIds.includes(agent.id);
            const statusColor = agent.selectable ? agent.color : '#64748b';
            return (
              <button
                key={agent.id}
                type="button"
                className="agent-checkbox"
                onClick={() => toggleAgent(agent)}
                disabled={!agent.selectable || isLoadingAgents}
                title={agent.diagnostic}
                aria-pressed={selected}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 7,
                  padding: '11px 13px',
                  borderRadius: 8,
                  border: `2px solid ${selected ? agent.color : '#334155'}`,
                  background: selected ? `${agent.color}15` : '#0d1117',
                  cursor: agent.selectable ? 'pointer' : 'not-allowed',
                  opacity: agent.selectable ? 1 : 0.62,
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{agent.icon}</span>
                  <span style={{ color: agent.color, fontWeight: 600, fontSize: 13, flex: 1 }}>{agent.name}</span>
                  <span style={{ color: statusColor, fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                    {readinessLabel(agent)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>
                    {agent.supportTier}
                  </span>
                  {agent.version && <span style={{ color: '#64748b', fontSize: 10 }}>{agent.version}</span>}
                </div>
                <div style={{ color: agent.selectable ? '#94a3b8' : '#fca5a5', fontSize: 11, lineHeight: 1.35 }}>
                  {agent.diagnostic}
                </div>
              </button>
            );
          })}
        </div>

        <button
          className="codex-button codex-button-primary"
          onClick={createDiscussion}
          disabled={!canStart}
          title={!workspace
            ? 'Choose a workspace first'
            : selectedAgents.length === 0
              ? 'Select at least one ready agent'
              : undefined}
        >
          {isCreating ? 'Starting…' : 'Start Discussion'}
        </button>
      </div>
    );
  }

  return (
    <div className="discussion-active" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        className="discussion-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          background: '#0d1117',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 16, color: '#e2e8f0' }}>Discussion</h2>
            {activeDiscussion.agents.map(id => {
              const agent = AGENT_VISUAL_MAP.get(id as AgentId);
              return agent ? (
                <span
                  key={id}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: `${agent.color}20`,
                    color: agent.color,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {agent.icon} {agent.fallbackName}
                </span>
              ) : null;
            })}
          </div>
          <div
            title={workspace}
            style={{ color: '#64748b', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {workspace}
          </div>
        </div>
        <button className="codex-button codex-button-danger" onClick={stopDiscussion}>Stop</button>
      </div>

      <div className="discussion-messages" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {activeDiscussion.history.length === 0 && (
          <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 20px' }}>
            Send the first message to begin the discussion.
          </div>
        )}
        {activeDiscussion.history.map(message => <MessageBubble key={message.id} message={message} />)}
        <div ref={messagesEndRef} />
      </div>

      <div
        className="discussion-input"
        style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid #1e293b', background: '#0d1117' }}
      >
        <textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type a message. Shift+Enter inserts a newline."
          disabled={isSending}
          rows={3}
          style={{
            flex: 1,
            resize: 'vertical',
            minHeight: 44,
            maxHeight: 180,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #334155',
            background: '#1a1f2e',
            color: '#e2e8f0',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          className="codex-button codex-button-primary"
          onClick={sendMessage}
          disabled={isSending || !input.trim()}
        >
          {isSending ? 'Working…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
