import React, { useState, useEffect, useRef } from 'react';
import type { DiscussionMessage } from '@/main/discussion-session';

interface Props {
  onError?: (message: string) => void;
}

// ─── Agent Config ──────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 'codex', name: 'Codex', color: '#10b981', icon: '⚡' },
  { id: 'open-interpreter', name: 'Open Interpreter', color: '#3b82f6', icon: '🐍' },
  { id: 'aider', name: 'Aider', color: '#f59e0b', icon: '🔧' },
  { id: 'claude-code', name: 'Claude Code', color: '#8b5cf6', icon: '💜' },
];

const AGENT_MAP = new Map(AGENTS.map(a => [a.id, a]));

// ─── Utility Functions ─────────────────────────────────────────────────────────

/** Strip ANSI escape codes from terminal output */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '').replace(/\r\n/g, '\n');
}

/** Simple markdown-to-HTML converter for code blocks and basic formatting */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeLang = '';
  let keyCounter = 0;

  for (const line of lines) {
    // Code block toggle
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${keyCounter++}`} className="discussion-code-block">
            <code>{stripAnsi(codeContent.join('\n'))}</code>
          </pre>
        );
        codeContent = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Empty lines
    if (line.trim() === '') {
      elements.push(<br key={`br-${keyCounter++}`} />);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h-${keyCounter++}`}>{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={`h-${keyCounter++}`}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={`h-${keyCounter++}`}>{renderInline(line.slice(2))}</h2>);
    }
    // Bold
    else if (line.includes('**')) {
      elements.push(<p key={`p-${keyCounter++}`}>{renderInline(line)}</p>);
    }
    // Regular paragraph
    else {
      elements.push(<p key={`p-${keyCounter++}`}>{renderInline(line)}</p>);
    }
  }

  // Close any unclosed code block
  if (inCodeBlock && codeContent.length > 0) {
    elements.push(
      <pre key={`code-${keyCounter++}`} className="discussion-code-block">
        <code>{stripAnsi(codeContent.join('\n'))}</code>
      </pre>
    );
  }

  return <>{elements}</>;
}

/** Render inline markdown (bold, italic, code) */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let keyCounter = 0;
  
  // Split by inline code first
  const segments = text.split(/(`[^`]+`)/g);
  
  for (const segment of segments) {
    if (segment.startsWith('`') && segment.endsWith('`')) {
      parts.push(
        <code key={`ic-${keyCounter++}`} className="discussion-inline-code">
          {segment.slice(1, -1)}
        </code>
      );
    } else {
      // Handle bold (**text**)
      const boldParts = segment.split(/(\*\*[^*]+\*\*)/g);
      for (const bp of boldParts) {
        if (bp.startsWith('**') && bp.endsWith('**')) {
          parts.push(<strong key={`b-${keyCounter++}`}>{bp.slice(2, -2)}</strong>);
        } else {
          parts.push(bp);
        }
      }
    }
  }

  return <>{parts}</>;
}

// ─── Message Bubble Component ──────────────────────────────────────────────────

function MessageBubble({ message }: { message: DiscussionMessage }) {
  const agent = message.agentId ? AGENT_MAP.get(message.agentId) : null;
  const isUser = message.role === 'user';
  const isSynthesis = message.role === 'synthesis';
  
  let bgColor = '#1a1f2e';
  let borderColor = '#334155';
  let showAvatar = false;
  let avatarText = '';
  let agentLabel = '';

  if (isUser) {
    bgColor = '#1e293b';
    borderColor = '#475569';
    showAvatar = true;
    avatarText = 'You';
  } else if (isSynthesis && agent) {
    bgColor = `${agent.color}15`;
    borderColor = agent.color;
    showAvatar = true;
    avatarText = agent.icon;
    agentLabel = agent.name;
  } else if (agent) {
    bgColor = `${agent.color}10`;
    borderColor = agent.color;
    showAvatar = true;
    avatarText = agent.icon;
    agentLabel = agent.name;
  }

  const timeStr = new Date(message.timestamp).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  return (
    <div className="discussion-message-bubble" style={{
      background: bgColor,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: '8px',
      padding: '12px 16px',
      marginBottom: '12px',
    }}>
      {showAvatar && (
        <div className="discussion-message-header" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}>
          <span style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: agent?.color || '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
          }}>
            {avatarText}
          </span>
          <div style={{ flex: 1 }}>
            <span style={{
              fontWeight: 600,
              color: agent?.color || '#94a3b8',
              fontSize: '13px',
            }}>
              {agentLabel || (isUser ? 'You' : 'Agent')}
            </span>
          </div>
          <span style={{
            color: '#64748b',
            fontSize: '11px',
          }}>
            {timeStr}
          </span>
        </div>
      )}
      <div className="discussion-message-content" style={{
        color: '#e2e8f0',
        fontSize: '14px',
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
      }}>
        {renderMarkdown(stripAnsi(message.content))}
      </div>
    </div>
  );
}

// ─── Main DiscussionPanel Component ────────────────────────────────────────────

export default function DiscussionPanel({ onError }: Props) {
  const [activeDiscussion, setActiveDiscussion] = useState<{
    sessionId: string;
    agents: string[];
    history: DiscussionMessage[];
  } | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [availableAgents, setAvailableAgents] = useState(AGENTS);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(['codex', 'open-interpreter']);
  const [isCreating, setIsCreating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDiscussion?.history]);

  // Load available agents from IPC on mount
  useEffect(() => {
    window.codexApi.getAvailableAgents().then((agents) => {
      const agentMap = new Map(agents.map(a => [a.id, a]));
      setAvailableAgents(AGENTS.map(a => {
        const db = agentMap.get(a.id);
        return db ? { ...a, name: db.name } : a;
      }));
    }).catch(() => {});
  }, []);

  // Subscribe to discussion events
  useEffect(() => {
    if (!activeDiscussion) return;

    const unsubMsg = window.codexApi.onDiscussionMessage(({ sessionId, message }) => {
      if (sessionId !== activeDiscussion.sessionId) return;
      setActiveDiscussion(prev => prev ? {
        ...prev,
        history: [...prev.history, message],
      } : null);
    });

    const unsubError = window.codexApi.onDiscussionError(({ sessionId, error }) => {
      if (sessionId !== activeDiscussion.sessionId) return;
      onError?.(`Discussion error: ${error}`);
    });

    return () => {
      unsubMsg();
      unsubError();
    };
  }, [activeDiscussion?.sessionId]);

  const handleCreateDiscussion = async () => {
    if (selectedAgentIds.length === 0) return;
    
    setIsCreating(true);
    try {
      const result = await window.codexApi.startDiscussion({
        repository: window.localStorage.getItem('consiglio:default-repository') || process.cwd(),
        agents: selectedAgentIds.map(id => ({ id })),
        maxTurns: 10,
        moderatorStrategy: 'context-aware',
      });
      
      setActiveDiscussion({
        sessionId: result.sessionId,
        agents: result.agents,
        history: [],
      });
    } catch (error) {
      onError?.(`Failed to start discussion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!activeDiscussion || !input.trim() || isSending) return;
    
    setIsSending(true);
    try {
      const history = await window.codexApi.sendDiscussionMessage(
        activeDiscussion.sessionId,
        input.trim()
      );
      
      setActiveDiscussion(prev => prev ? { ...prev, history } : null);
      setInput('');
    } catch (error) {
      onError?.(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleStopDiscussion = async () => {
    if (!activeDiscussion) return;
    
    try {
      await window.codexApi.stopDiscussion(activeDiscussion.sessionId);
      setActiveDiscussion(null);
    } catch (error) {
      onError?.(`Failed to stop discussion: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  // ─── Empty State (no active discussion) ──────────────────────────────────────

  if (!activeDiscussion) {
    return (
      <div className="discussion-setup">
        <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: '#e2e8f0' }}>
          Multi-Agent Discussion
        </h2>
        <p style={{ margin: '0 0 20px', color: '#94a3b8', fontSize: '13px' }}>
          Select agents to discuss your prompt. Each agent brings different strengths.
        </p>
        
        <div className="agent-selection" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
          {availableAgents.map(agent => (
            <label
              key={agent.id}
              className="agent-checkbox"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: `2px solid ${selectedAgentIds.includes(agent.id) ? agent.color : '#334155'}`,
                background: selectedAgentIds.includes(agent.id) ? `${agent.color}15` : '#0d1117',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <input
                type="checkbox"
                checked={selectedAgentIds.includes(agent.id)}
                onChange={() => toggleAgent(agent.id)}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: '16px' }}>{agent.icon}</span>
              <span style={{ color: agent.color, fontWeight: 500, fontSize: '13px' }}>
                {agent.name}
              </span>
            </label>
          ))}
        </div>
        
        <button
          onClick={handleCreateDiscussion}
          disabled={selectedAgentIds.length === 0 || isCreating}
          style={{
            padding: '10px 24px',
            borderRadius: '8px',
            border: 'none',
            background: selectedAgentIds.length > 0 ? '#3b82f6' : '#334155',
            color: '#fff',
            fontWeight: 600,
            fontSize: '14px',
            cursor: selectedAgentIds.length > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {isCreating ? 'Starting...' : 'Start Discussion'}
        </button>
      </div>
    );
  }

  // ─── Active Discussion View ──────────────────────────────────────────────────

  return (
    <div className="discussion-active" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="discussion-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #1e293b',
        background: '#0d1117',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#e2e8f0' }}>Discussion</h2>
          <div style={{ display: 'flex', gap: '6px' }}>
            {activeDiscussion.agents.map(id => {
              const agent = AGENT_MAP.get(id);
              return agent ? (
                <span key={id} style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: `${agent.color}20`,
                  color: agent.color,
                  fontSize: '11px',
                  fontWeight: 500,
                }}>
                  {agent.icon} {agent.name}
                </span>
              ) : null;
            })}
          </div>
        </div>
        <button
          onClick={handleStopDiscussion}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: '1px solid #ef4444',
            background: 'transparent',
            color: '#ef4444',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Stop
        </button>
      </div>

      {/* Messages */}
      <div className="discussion-messages" style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
      }}>
        {activeDiscussion.history.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#64748b',
            padding: '40px 20px',
          }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              Start the discussion by sending a message below.
            </p>
          </div>
        )}
        
        {activeDiscussion.history.map(message => (
          <MessageBubble key={message.id} message={message} />
        ))}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="discussion-input" style={{
        display: 'flex',
        gap: '8px',
        padding: '12px 16px',
        borderTop: '1px solid #1e293b',
        background: '#0d1117',
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Type a message..."
          disabled={isSending}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: '8px',
            border: '1px solid #334155',
            background: '#1a1f2e',
            color: '#e2e8f0',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSendMessage}
          disabled={isSending || !input.trim()}
          style={{
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: input.trim() ? '#3b82f6' : '#334155',
            color: '#fff',
            fontWeight: 600,
            fontSize: '14px',
            cursor: input.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {isSending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
