import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { ApprovalRecord, BridgeClient, SessionEvent, SessionRecord } from './api';

const savedEndpoint = window.localStorage.getItem('consiglio:mobile-endpoint') || '';

function shortRepository(repository: string) {
  const parts = repository.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || repository || 'Workspace';
}

function eventLabel(type: string) {
  if (type === 'prompt') return 'You';
  if (type === 'response') return 'Consiglio';
  return type.replaceAll('_', ' ');
}

export default function App() {
  const [endpoint, setEndpoint] = useState(savedEndpoint);
  const [token, setToken] = useState('');
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => sessions.find(session => session.id === selectedId) || null, [sessions, selectedId]);

  const refresh = useCallback(async (activeClient = client, activeSessionId = selectedId) => {
    if (!activeClient) return;
    const [nextSessions, nextApprovals] = await Promise.all([activeClient.sessions(), activeClient.approvals()]);
    setSessions(nextSessions);
    const nextId = activeSessionId && nextSessions.some(session => session.id === activeSessionId) ? activeSessionId : nextSessions[0]?.id || null;
    setSelectedId(nextId);
    setApprovals(nextApprovals);
    setEvents(nextId ? await activeClient.events(nextId) : []);
  }, [client, selectedId]);

  useEffect(() => {
    if (!client) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(error => setError((error as Error).message));
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [client, refresh]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const nextClient = new BridgeClient({ endpoint, token });
      await nextClient.health();
      window.localStorage.setItem('consiglio:mobile-endpoint', nextClient.endpoint);
      setEndpoint(nextClient.endpoint);
      setClient(nextClient);
      await refresh(nextClient, null);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function selectSession(sessionId: string) {
    if (!client) return;
    setSelectedId(sessionId);
    setEvents(await client.events(sessionId));
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    if (!client || !selected || !prompt.trim()) return;
    setBusy(true);
    try {
      const result = await client.sendInput(selected.id, prompt.trim());
      if (!result.ok) throw new Error('The desktop did not accept the prompt. Reconnect the session and try again.');
      setPrompt('');
      await refresh(client, selected.id);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function sessionAction(action: 'reconnect' | 'stop') {
    if (!client || !selected) return;
    setBusy(true);
    try {
      const result = await client[action](selected.id);
      if (!result.ok) throw new Error(`Could not ${action} this session.`);
      await refresh(client, selected.id);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function decide(approvalId: string, decision: 'approve' | 'reject') {
    if (!client) return;
    setBusy(true);
    try {
      const result = await client.decide(approvalId, decision);
      if (!result.ok) throw new Error(`Could not ${decision} this request.`);
      await refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  if (!client) {
    return (
      <main className="connect-shell">
        <section className="connect-card" aria-labelledby="connect-title">
          <div className="mark">C</div>
          <p className="eyebrow">Consiglio mobile</p>
          <h1 id="connect-title">Your agents, within reach.</h1>
          <p className="lede">Connect to the bridge running on your desktop. The bridge URL must be protected by HTTPS.</p>
          <form onSubmit={connect}>
            <label>Bridge URL<input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://consiglio.example.ts.net" required /></label>
            <label>Pairing token<input type="password" value={token} onChange={event => setToken(event.target.value)} minLength={32} autoComplete="off" required /></label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect securely'}</button>
          </form>
          <p className="privacy-note">The token stays in memory for this app session and is not written to mobile storage.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header><div><p className="eyebrow">Consiglio</p><h1>{selected ? shortRepository(selected.repository) : 'No sessions'}</h1></div><button className="quiet" onClick={() => { setClient(null); setToken(''); }}>Disconnect</button></header>
      {error && <button className="error banner" onClick={() => setError(null)}>{error}</button>}
      <nav className="session-strip" aria-label="Sessions">
        {sessions.map(session => <button key={session.id} className={session.id === selectedId ? 'session active' : 'session'} onClick={() => void selectSession(session.id)}><span className={`status ${session.status}`} /><strong>{shortRepository(session.repository)}</strong><small>{session.branch || session.status}</small></button>)}
      </nav>
      {approvals.length > 0 && <section className="approvals" aria-labelledby="approvals-title"><h2 id="approvals-title">Needs your decision <span>{approvals.length}</span></h2>{approvals.map(approval => <article key={approval.id}><code>{approval.command}</code><p>{approval.workingDir}</p><div><button className="reject" disabled={busy} onClick={() => void decide(approval.id, 'reject')}>Reject</button><button className="approve" disabled={busy} onClick={() => void decide(approval.id, 'approve')}>Approve</button></div></article>)}</section>}
      <section className="timeline" aria-live="polite">
        {events.length === 0 && <div className="empty"><h2>Quiet for now</h2><p>Select a session or send the next instruction.</p></div>}
        {events.map(item => <article key={item.id} className={`event ${item.type}`}><div><strong>{eventLabel(item.type)}</strong><time>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><pre>{item.content}</pre></article>)}
      </section>
      {selected && <footer><div className="session-actions"><button className="quiet" disabled={busy || selected.status === 'running'} onClick={() => void sessionAction('reconnect')}>Reconnect</button><button className="quiet" disabled={busy || selected.status !== 'running'} onClick={() => void sessionAction('stop')}>Stop</button></div><form onSubmit={submitPrompt}><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Tell Consiglio what to do next…" rows={2} maxLength={50_000} /><button className="send" disabled={busy || !prompt.trim()} aria-label="Send prompt">↑</button></form></footer>}
    </main>
  );
}
