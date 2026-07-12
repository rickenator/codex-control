import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  sessionId: string | null;
  compact?: boolean;
  onCopyTranscript: (text: string, label: string) => void;
  onRequestNewSession: () => Promise<void>;
  onClearTerminal?: () => void;
}

export default function TerminalPane({ sessionId, compact = false, onCopyTranscript, onRequestNewSession, onClearTerminal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    const fitTerminal = () => {
      fit.fit();
      if (terminal.cols > 0 && terminal.rows > 0) {
        void window.codexApi.resizeTerminal(sessionId, terminal.cols, terminal.rows);
      }
    };
    fitTerminal();
    terminal.focus();
    void window.codexApi.getTerminalBuffer(sessionId).then(buffer => terminal.write(buffer));

    const input = terminal.onData(data => window.codexApi.sendInput(sessionId, data));
    const output = window.codexApi.onTerminalOutput(message => {
      if (message.sessionId === sessionId) terminal.write(message.data);
    });
    const resizeObserver = new ResizeObserver(() => fitTerminal());
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    const resize = () => fitTerminal();
    window.addEventListener('resize', resize);
    return () => {
      input.dispose();
      output();
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div className={`codex-terminal-pane${compact ? ' compact' : ''}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {sessionId && (
        <div
          className="codex-toolbar"
          style={{
            padding: compact ? '6px 12px' : '8px 14px',
            fontSize: 12,
            color: '#8b949e',
            borderBottom: compact ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.10)',
            background: compact ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.03)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ color: '#f0f6fc', fontWeight: 600 }}>Terminal</span>
            <span>Live command stream for this session</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {onClearTerminal && (
              <button
                className="codex-button codex-button-secondary"
                onClick={() => onClearTerminal()}
                style={{ fontSize: 10, padding: '4px 8px' }}
              >
                Clear
              </button>
            )}
            <button
              className="codex-button codex-button-secondary"
              onClick={async () => {
                const buffer = await window.codexApi.getTerminalBuffer(sessionId);
                onCopyTranscript(buffer, 'Terminal transcript');
              }}
            >
              Copy transcript
            </button>
          </div>
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        {!sessionId && (
          <div className="codex-empty-state" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100%' }}>
            Start a session to open the real Codex terminal.
            <div style={{ marginTop: 10 }}>
              <button className="codex-button codex-button-primary" onClick={() => void onRequestNewSession()}>
                Open new session drawer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
