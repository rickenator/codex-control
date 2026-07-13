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

const eventLabels: Record<string, string> = {
  prompt: 'You',
  response: 'Codex',
  tool_call: 'Working',
  approval_request: 'Approval required',
  diff: 'Changes',
  error: 'Error',
  output: 'Output',
  files: 'Files',
};

export default function EventTimeline({ sessionId, compact = false, onCopySessionId, onRequestNewSession, onError }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setIsAwaitingResponse(false);
      return;
    }

    // Load existing events
    window.codexApi.getSessionEvents(sessionId)
      .then((loadedEvents: Event[]) => {
        setEvents(loadedEvents);
        setIsAwaitingResponse(loadedEvents.length > 0 && loadedEvents[loadedEvents.length - 1]?.type === 'prompt');
      })
      .catch((error: Error) => {
        onError?.(`Could not load session events: ${error.message}`);
      });

    // Subscribe to new events
    const unsubscribe = window.codexApi.onEvent((event: Event) => {
      if (event.session_id !== sessionId) return;
      setEvents(prev => {
        if (event.type === 'prompt') {
          const optimisticIndex = prev.findIndex(candidate => candidate.id.startsWith('local-') && candidate.content === event.content);
          if (optimisticIndex >= 0) {
            const next = [...prev];
            next[optimisticIndex] = event;
            return next;
          }
        }
        return [...prev, event];
      });
      if (event.type === 'response' || event.type === 'error') {
        setIsAwaitingResponse(false);
      }
    });

    return () => {
      unsubscribe();
    };
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
    if (!input.trim() || !sessionId || isSending || isAwaitingResponse) return;

    const promptText = input.trim();
    const optimisticEvent: Event = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'prompt',
      content: promptText,
      timestamp: Date.now(),
      session_id: sessionId,
    };

    setIsSending(true);
    setIsAwaitingResponse(true);
    setEvents(prev => [...prev, optimisticEvent]);
    setInput('');
    try {
      let sent = await window.codexApi.sendInput(sessionId, promptText);
      if (!sent) {
        const reconnected = await window.codexApi.reconnectSession(sessionId);
        if (reconnected) {
          sent = await window.codexApi.sendInput(sessionId, promptText);
        }
      }
      if (!sent) throw new Error('Could not reconnect this task. Start a new task and try again.');
    } catch (e) {
      setEvents(prev => prev.filter(event => event.id !== optimisticEvent.id));
      setInput(promptText);
      setIsAwaitingResponse(false);
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
            <span>Start a task and tell Codex what you want done.</span>
            <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
              New task
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={`codex-conversation${compact ? ' codex-conversation-compact' : ''}`}>
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
      <div ref={timelineRef} className="codex-message-scroll">
        {events.length === 0 && (
          <div className="codex-empty-state">
            Tell Codex what you want to build, fix, or investigate.
          </div>
        )}

        {events.filter(event => event.type !== 'system').map((event) => (
          <div
            key={event.id}
            className={`codex-message codex-message-${event.type === 'prompt' ? 'user' : event.type === 'response' ? 'agent' : 'activity'}`}
          >
            <div className="codex-message-meta">
              <div className="codex-message-author">
                <span>{eventLabels[event.type] || 'Event'}</span>
                <time>{formatEventTime(event.timestamp)}</time>
              </div>
              <button
                className="codex-message-copy"
                onClick={() => onCopySessionId(event.content)}
                title="Copy message"
              >
                Copy
              </button>
            </div>
            {event.type === 'files' ? (
              <InlineFileGallery sessionId={sessionId} content={event.content} />
            ) : (
              <div className="codex-message-content">
                {event.content}
              </div>
            )}
          </div>
        ))}
        {isAwaitingResponse && (
          <div className="codex-thinking" role="status" aria-live="polite">
            <span className="codex-spinner" aria-hidden="true" />
            <span>Working…</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="codex-composer-wrap">
        <div className="codex-composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Codex to work on this repository"
            disabled={isSending || isAwaitingResponse}
            className="codex-textarea"
            rows={2}
          />
          <button
            className="codex-button codex-button-primary"
            onClick={handleSend}
            disabled={isSending || isAwaitingResponse || !input.trim()}
          >
            {isSending || isAwaitingResponse ? <span className="codex-spinner" aria-hidden="true" /> : 'Send'}
          </button>
        </div>
        <div className="codex-composer-hint">
          <span>{isAwaitingResponse && !isSending ? 'Response in progress' : 'Enter to send'}</span>
          <span>Shift+Enter for a new line</span>
        </div>
      </div>
    </main>
  );
}

function InlineFileGallery({ sessionId, content }: { sessionId: string; content: string }) {
  const [images, setImages] = useState<Array<{ path: string; dataUrl: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    let paths: string[] = [];
    try {
      paths = (JSON.parse(content) as { paths?: string[] }).paths || [];
    } catch {
      return;
    }
    Promise.all(paths.map(async (filePath) => {
      const preview = await window.codexApi.readWorkspaceFile(sessionId, filePath);
      return preview.kind === 'image' ? { path: preview.path, dataUrl: preview.dataUrl } : null;
    }))
      .then(results => {
        if (!cancelled) setImages(results.filter((result): result is { path: string; dataUrl: string } => Boolean(result)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [content, sessionId]);

  if (images.length === 0) return <div className="codex-message-content">Loading image previews…</div>;

  return (
    <div className="codex-inline-gallery">
      {images.map(image => (
        <figure key={image.path}>
          <img src={image.dataUrl} alt={image.path} />
          <figcaption title={image.path}>{image.path}</figcaption>
        </figure>
      ))}
    </div>
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
