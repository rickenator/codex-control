import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  sessionId: string | null;
  compact?: boolean;
}

export default function TerminalPane({ sessionId, compact = false }: Props) {
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
    fit.fit();
    window.codexApi.resizeTerminal(sessionId, terminal.cols, terminal.rows);
    terminal.focus();
    window.codexApi.getTerminalBuffer(sessionId).then(buffer => terminal.write(buffer));

    const input = terminal.onData(data => window.codexApi.sendInput(sessionId, data));
    const output = window.codexApi.onTerminalOutput(message => {
      if (message.sessionId === sessionId) terminal.write(message.data);
    });
    const resize = () => {
      fit.fit();
      window.codexApi.resizeTerminal(sessionId, terminal.cols, terminal.rows);
    };
    window.addEventListener('resize', resize);
    return () => {
      input.dispose();
      output();
      window.removeEventListener('resize', resize);
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, background: compact ? 'transparent' : '#0d1117', padding: compact ? 0 : 6 }}>
      {!sessionId && (
        <div style={{ color: '#8b949e', fontFamily: 'monospace', fontSize: 12, padding: 8 }}>
          Start a session to open the real Codex terminal.
        </div>
      )}
    </div>
  );
}
