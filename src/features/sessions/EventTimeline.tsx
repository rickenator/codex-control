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

export default function EventTimeline({ sessionId, compact = false }: Props) {
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
    window.codexApi.getSessionEvents(sessionId).then((loadedEvents: Event[]) => {
      setEvents(loadedEvents);
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
      console.error('Failed to reconnect:', e);
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
      console.error('Failed to send input:', e);
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

  if (!sessionId) {
    return (
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13, padding: 16 }}>
          No session selected. Start a session to see the timeline here.
        </div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: compact ? 'transparent' : '#0d1117' }}>
      {!compact && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #21262d', fontSize: 13, color: '#8b949e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Session: {sessionId}</span>
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            style={{
              padding: '4px 8px',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: 4,
              color: '#58a6ff',
              fontSize: 11,
              cursor: isReconnecting ? 'not-allowed' : 'pointer',
            }}
          >
            {isReconnecting ? 'Reconnecting...' : '↻ Reconnect'}
          </button>
        </div>
      )}

      {/* Event timeline */}
      <div ref={timelineRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? '12px 14px' : 16 }}>
        {events.length === 0 && (
          <div style={{ color: '#484f58', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            No events yet. Send a message to start the conversation.
          </div>
        )}

        {events.map((event, index) => (
          <div
            key={event.id}
            style={{
              marginBottom: 12,
              paddingLeft: 12,
              borderLeft: `3px solid ${eventColors[event.type] || '#8b949e'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>{eventIcons[event.type] || '📝'}</span>
              <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}>
                {event.type}
              </span>
              <span style={{ fontSize: 10, color: '#484f58' }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#c9d1d9',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !input.trim()}
            style={{
              padding: '8px 16px',
              background: input.trim() ? '#238636' : '#30363d',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              cursor: input.trim() ? 'pointer' : 'not-allowed',
              fontWeight: 500,
            }}
          >
            {isSending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </main>
  );
}
