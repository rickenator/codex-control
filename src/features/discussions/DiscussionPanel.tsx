import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DiscussionMessage } from '@/main/discussion-session';

interface Props {
  onError?: (message: string) => void;
}

interface AgentDescriptor {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface ActiveDiscussion {
  sessionId: string;
  agents: string[];
  history: DiscussionMessage[];
}

const AGENTS: AgentDescriptor[] = [
  { id: 'codex', name: 'Codex', color: '#10b981', icon: '⚡' },
  { id: 'open-interpreter', name: 'Open Interpreter', color: '#3b82f6', icon: '🐍' },
  { id: 'aider', name: 'Aider', color: '#f59e0b', icon: '🔧' },
  { id: 'claude-code', name: 'Claude Code', color: '#8b5cf6', icon: '◆' },
];

const AGENT_MAP = new Map(AGENTS.map(agent => [agent.id, agent]));
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
  const agent = message.agentId ? AGENT_MAP.get(message.agentId) : undefined;
  const isUser = message.role === 'user';
  const isSynthesis = message.role === 'synthesis';
  const accent = agent?.color || '#64748b';
  const label = isUser ? 'You' : isSynthesis ? `${agent?.name || 'Agent'} · synthesis` : agent?.name || 'Agent';
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

export default function DiscussionPanel({ onError }: Props) {
  const [activeDiscussion, setActiveDiscussion] = useState<ActiveDiscussion | null>(null);
  const [input, setInput] = useState('');
  const [workspace, setWorkspace] = useState(() => window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || '');
  const [availableAgents, setAvailableAgents] = useState<AgentDescriptor[]>(AGENTS);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(['codex', 'open-interpreter']);
  const [isCreating, setIsCreating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedAgents = useMemo(
    () => availableAgents.filter(agent => selectedAgentIds.includes(agent.id)),
    [availableAgents, selectedAgentIds],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDiscussion?.history]);

  useEffect(() => {
    window.codexApi.getAvailableAgents().then(detected => {
      const detectedById = new Map(detected.map(agent => [agent.id, agent]));
      setAvailableAgents(AGENTS.map(agent => ({
        ...agent,
        name: detectedById.get(agent.id)?.name || agent.name,
      })));
    }).catch(() => {});
  }, []);

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

    setIsCreating(true);
    try {
      const result = await window.codexApi.startDiscussion({
        repository: workspace,
        agents: selectedAgents.map(agent => ({ id: agent.id })),
        maxTurns: selectedAgents.length,
        moderatorStrategy: 'context-aware',
        synthesisAgent: selectedAgents.length > 1 ? selectedAgents[0].id : undefined,
      });

      setActiveDiscussion({
        sessionId: result.sessionId,
        agents: result.agents,
        history: result.history || [],
      });
    } catch (error) {
      onError?.(`Failed to start discussion: ${error instanceof Error ? error.message : String(error)}`);
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

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(current => current.includes(agentId)
      ? current.filter(id => id !== agentId)
      : [...current, agentId]);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void sendMessage();
  };

  if (!activeDiscussion) {
    const canStart = Boolean(workspace) && selectedAgents.length > 0 && !isCreating;

    return (
      <div className="discussion-setup" style={{ padding: 20, overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#e2e8f0' }}>Multi-Agent Discussion</h2>
        <p style={{ margin: '0 0 20px', color: '#94a3b8', fontSize: 13 }}>
          Give each selected agent one turn, then let the first agent synthesize the result.
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

        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Agents</div>
        <div className="agent-selection" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {availableAgents.map(agent => {
            const selected = selectedAgentIds.includes(agent.id);
            return (
              <label
                key={agent.id}
                className="agent-checkbox"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: `2px solid ${selected ? agent.color : '#334155'}`,
                  background: selected ? `${agent.color}15` : '#0d1117',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleAgent(agent.id)}
                  style={{ display: 'none' }}
                />
                <span style={{ fontSize: 16 }}>{agent.icon}</span>
                <span style={{ color: agent.color, fontWeight: 500, fontSize: 13 }}>{agent.name}</span>
              </label>
            );
          })}
        </div>

        <button
          className="codex-button codex-button-primary"
          onClick={createDiscussion}
          disabled={!canStart}
          title={!workspace ? 'Choose a workspace first' : undefined}
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
              const agent = AGENT_MAP.get(id);
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
                  {agent.icon} {agent.name}
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
