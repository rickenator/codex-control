import React, { useState, useEffect, useRef } from 'react';

interface DiscussionMessage {
  id: string;
  role: 'user' | 'agent' | 'synthesis';
  agentId?: string;
  content: string;
  timestamp: number;
}

interface DiscussionSessionInfo {
  sessionId: string;
  agents: string[];
  history: DiscussionMessage[];
}

interface Props {
  onError?: (message: string) => void;
}

const agentColors: Record<string, string> = {
  'codex': '#10b981',
  'open-interpreter': '#3b82f6',
  'aider': '#f59e0b',
  'claude-code': '#8b5cf6',
};

const roleLabels: Record<string, string> = {
  'user': 'You',
  'agent': 'Agent',
  'synthesis': 'Synthesis',
};

export default function DiscussionPanel({ onError }: Props) {
  const [activeDiscussion, setActiveDiscussion] = useState<DiscussionSessionInfo | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string }>>([
    { id: 'codex', name: 'Codex' },
    { id: 'open-interpreter', name: 'Open Interpreter' },
  ]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(['codex', 'open-interpreter']);
  const [isCreating, setIsCreating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeDiscussion?.history]);

  // Load available agents
  useEffect(() => {
    window.codexApi.getAvailableAgents?.().then((agents: Array<{ id: string; name: string }>) => {
      if (agents) setAvailableAgents(agents);
    }).catch(() => {});
  }, []);

  const handleCreateDiscussion = async () => {
    if (selectedAgents.length === 0) return;
    
    setIsCreating(true);
    try {
      const result = await window.codexApi.startDiscussion({
        repository: window.localStorage.getItem('consiglio:default-repository') || process.cwd(),
        agents: selectedAgents.map(id => ({ id })),
        maxTurns: 10,
        moderatorStrategy: 'round-robin',
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

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (!activeDiscussion) {
    return (
      <div className="discussion-panel">
        <h2>Multi-Agent Discussion</h2>
        <p>Select agents to include in the discussion:</p>
        
        <div className="agent-selection">
          {availableAgents.map(agent => (
            <label key={agent.id} className="agent-checkbox">
              <input
                type="checkbox"
                checked={selectedAgents.includes(agent.id)}
                onChange={() => {
                  setSelectedAgents(prev =>
                    prev.includes(agent.id)
                      ? prev.filter(id => id !== agent.id)
                      : [...prev, agent.id]
                  );
                }}
              />
              <span style={{ color: agentColors[agent.id] || '#888' }}>{agent.name}</span>
            </label>
          ))}
        </div>
        
        <button
          onClick={handleCreateDiscussion}
          disabled={selectedAgents.length === 0 || isCreating}
          className="discussion-start-button"
        >
          {isCreating ? 'Starting...' : 'Start Discussion'}
        </button>
      </div>
    );
  }

  return (
    <div className="discussion-panel">
      <div className="discussion-header">
        <h2>Discussion</h2>
        <span className="discussion-agents">
          {activeDiscussion.agents.map(id => (
            <span key={id} style={{ color: agentColors[id] || '#888' }}>
              {id.replace('-', ' ')}
            </span>
          ))}
        </span>
        <button onClick={handleStopDiscussion} className="discussion-stop-button">
          Stop
        </button>
      </div>
      
      <div className="discussion-messages">
        {activeDiscussion.history.map(message => (
          <div
            key={message.id}
            className={`discussion-message ${message.role}`}
            style={{
              borderLeft: `3px solid ${
                message.role === 'user' ? '#888' :
                message.role === 'synthesis' ? '#f59e0b' :
                agentColors[message.agentId || ''] || '#888'
              }`
            }}
          >
            <div className="discussion-message-header">
              <span className="discussion-message-role">
                {roleLabels[message.role]}
                {message.agentId && ` (${message.agentId})`}
              </span>
              <span className="discussion-message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="discussion-message-content">
              {message.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="discussion-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Type a message..."
          disabled={isSending}
        />
        <button onClick={handleSendMessage} disabled={isSending || !input.trim()}>
          {isSending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
