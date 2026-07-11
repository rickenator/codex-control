import React, { useState, useEffect, useRef } from 'react';

interface Event {
  id: string;
  type: string;
  content: string;
  timestamp: number;
  session_id: string;
}

interface Props {
  sessionId: string | null;
  compact?: boolean;
  onCopySessionId: (sessionId: string) => void;
  onRequestNewSession: () => Promise<void>;
  onError?: (message: string) => void;
}

const eventColors: Record<string, string> = {
  prompt: '#58a6ff',
  response: '#3fb950',
  tool_call: '#d29922',
  approval_request: '#f85149',
  diff: '#a371f7',
  error: '#f85149',
  output: '#8b949e',
};

const eventIcons: Record<string, string> = {
  prompt: '👤',
  response: '🤖',
  tool_call: '⚙️',
  approval_request: '⏳',
  diff: '📄',
  error: '❌',
  output: '📝',
};

export default function EventTimeline({ sessionId, compact = false, onCopySessionId, onRequestNewSession, onError }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      return;
    }

    // Load existing events
    window.codexApi.getSessionEvents(sessionId)
      .then((loadedEvents: Event[]) => {
        setEvents(loadedEvents);
      })
      .catch((error: Error) => {
        onError?.(`Could not load session events: ${error.message}`);
      });

    // Subscribe to new events
    const unsubscribe = window.codexApi.onEvent((event: Event) => {
      if (event.session_id === sessionId) setEvents(prev => [...prev, event]);
    });

    return () => unsubscribe();
  }, [sessionId]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [events]);

  const handleReconnect = async () => {
    if (!sessionId || isReconnecting) return;

    setIsReconnecting(true);
    try {
      await window.codexApi.reconnectSession(sessionId);
      // Events will be re-emitted via the onEvent listener
    } catch (e) {
      onError?.(`Could not reconnect session: ${(e as Error).message}`);
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionId || isSending) return;

    setIsSending(true);
    try {
      await window.codexApi.sendInput(sessionId, input.trim() + '\n');
      setInput('');
    } catch (e) {
      onError?.(`Could not send input: ${(e as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastEvent = events[events.length - 1];
  const sessionLabel = sessionId ? `Session ${sessionId.slice(0, 8)}` : 'Session';

  if (!sessionId) {
    return (
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="codex-empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <span>No session selected. Start a session to see the timeline here.</span>
            <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
              Open new session drawer
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: compact ? 'transparent' : '#0d1117' }}>
      {!compact && (
        <div className="codex-toolbar" style={{ fontSize: 13, color: '#8b949e', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ color: '#f0f6fc', fontWeight: 600 }}>
              {sessionLabel}
            </span>
            <span>
              {events.length} event{events.length === 1 ? '' : 's'}
              {lastEvent ? ` · last ${formatRelativeTime(lastEvent.timestamp)}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="codex-button codex-button-secondary"
              onClick={() => onCopySessionId(sessionId)}
              style={{ color: '#58a6ff' }}
            >
              Copy ID
            </button>
            <button
              className="codex-button codex-button-secondary"
              onClick={handleReconnect}
              disabled={isReconnecting}
              style={{ color: '#58a6ff', cursor: isReconnecting ? 'not-allowed' : 'pointer' }}
            >
              {isReconnecting ? 'Reconnecting...' : '↻ Reconnect'}
            </button>
          </div>
        </div>
      )}

      {/* Event timeline */}
      <div ref={timelineRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? '12px 14px' : 16 }}>
        {events.length === 0 && (
          <div className="codex-empty-state">
            No events yet. Send a message to start the conversation.
            <div style={{ marginTop: 10 }}>
              <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
                Open new session drawer
              </button>
            </div>
          </div>
        )}

        {events.map((event, index) => (
          <div
            key={event.id}
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderLeft: `3px solid ${eventColors[event.type] || '#8b949e'}`,
              boxShadow: index === events.length - 1 ? '0 8px 20px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 14 }}>{eventIcons[event.type] || '📝'}</span>
                <span style={{ fontSize: 11, color: '#f0f6fc', textTransform: 'uppercase', fontWeight: 600 }}>
                  {event.type}
                </span>
                <span style={{ fontSize: 10, color: '#8b949e' }}>
                  {formatEventTime(event.timestamp)}
                </span>
              </div>
              <button
                className="codex-button codex-button-secondary"
                style={{ padding: '4px 9px', fontSize: 11 }}
                onClick={() => onCopySessionId(event.id)}
                title="Copy event ID"
              >
                ID
              </button>
            </div>
            <div style={{ fontSize: 13, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
              {event.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div style={{ padding: 12, borderTop: compact ? '1px solid rgba(255,255,255,0.08)' : '1px solid #21262d', background: compact ? 'rgba(255,255,255,0.02)' : '#161b22' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isSending}
            className="codex-input"
            style={{ flex: 1, background: '#0d1117' }}
          />
          <button
            className="codex-button codex-button-primary"
            onClick={handleSend}
            disabled={isSending || !input.trim()}
            style={{
              padding: '8px 16px',
              background: input.trim() ? 'rgba(35, 134, 54, 0.92)' : 'rgba(255, 255, 255, 0.06)',
              color: '#fff',
              cursor: input.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {isSending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </main>
  );
}

function formatEventTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(timestamp: number) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'just now';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
