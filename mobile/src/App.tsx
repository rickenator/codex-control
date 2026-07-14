import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { ApprovalRecord, BridgeClient, SessionEvent, SessionRecord } from './api';
import { parsePairingUri, type PairingConfig } from './pairing-config';
import { clearPairing, loadPairing, savePairing } from './secure-pairing';

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
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [hasSavedPairing, setHasSavedPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => sessions.find(session => session.id === selectedId) || null, [sessions, selectedId]);

  const resetClientState = useCallback(() => {
    setClient(null);
    setToken('');
    setSessions([]);
    setEvents([]);
    setApprovals([]);
    setSelectedId(null);
    setHasSavedPairing(false);
  }, []);

  const handleClientError = useCallback(async (failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (/unauthorized|401/i.test(message)) {
      await clearPairing().catch(() => undefined);
      resetClientState();
      setError('This pairing was revoked. Create a new token from Consiglio on the desktop.');
      return;
    }
    setError(message);
  }, [resetClientState]);

  const hydrate = useCallback(async (activeClient: BridgeClient, activeSessionId: string | null) => {
    const [nextSessions, nextApprovals] = await Promise.all([activeClient.sessions(), activeClient.approvals()]);
    setSessions(nextSessions);
    const nextId = activeSessionId && nextSessions.some(session => session.id === activeSessionId) ? activeSessionId : nextSessions[0]?.id || null;
    setSelectedId(nextId);
    setApprovals(nextApprovals);
    setEvents(nextId ? await activeClient.events(nextId) : []);
  }, []);

  const refresh = useCallback(async (activeClient = client, activeSessionId = selectedId) => {
    if (!activeClient) return;
    await hydrate(activeClient, activeSessionId);
  }, [client, hydrate, selectedId]);

  const restoreSavedPairing = useCallback(async () => {
    setRestoring(true);
    setError(null);
    try {
      const saved = await loadPairing();
      if (!saved) {
        setHasSavedPairing(false);
        return;
      }
      setHasSavedPairing(true);
      setEndpoint(saved.endpoint);
      const nextClient = new BridgeClient(saved);
      await nextClient.health();
      await hydrate(nextClient, null);
      setClient(nextClient);
    } catch (restoreError) {
      const message = (restoreError as Error).message;
      if (/unauthorized|401/i.test(message)) {
        await clearPairing().catch(() => undefined);
        resetClientState();
        setError('This pairing was revoked. Create a new token from Consiglio on the desktop.');
      } else {
        setError(`Could not reconnect the saved device: ${message}`);
      }
    } finally {
      setRestoring(false);
    }
  }, [hydrate, resetClientState]);

  useEffect(() => {
    void restoreSavedPairing();
  }, [restoreSavedPairing]);

  useEffect(() => {
    if (!client) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(handleClientError);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [client, handleClientError, refresh]);

  async function activatePairing(config: PairingConfig) {
    const nextClient = new BridgeClient(config);
    await nextClient.health();
    await savePairing({ endpoint: nextClient.endpoint, token: config.token });
    setEndpoint(nextClient.endpoint);
    setHasSavedPairing(true);
    setToken('');
    await hydrate(nextClient, null);
    setClient(nextClient);
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await activatePairing({ endpoint, token });
    } catch (connectError) { setError((connectError as Error).message); }
    finally { setBusy(false); }
  }

  async function scanPairing() {
    setBusy(true);
    setError(null);
    try {
      const {
        CapacitorBarcodeScanner,
        CapacitorBarcodeScannerCameraDirection,
        CapacitorBarcodeScannerTypeHint,
      } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanInstructions: 'Scan the pairing code shown by Consiglio on your desktop',
        scanButton: false,
        cancelButtonAccessibilityLabel: 'Cancel Consiglio pairing scan',
        torchButtonOnAccessibilityLabel: 'Turn flashlight off',
        torchButtonOffAccessibilityLabel: 'Turn flashlight on',
      });
      const config = parsePairingUri(result.ScanResult);
      setEndpoint(config.endpoint);
      await activatePairing(config);
    } catch (scanError) {
      const message = (scanError as Error).message;
      setError(/permission|denied|camera access/i.test(message)
        ? 'Camera access is required to scan a code. Allow access in system settings or enter the pairing manually.'
        : `Could not scan this pairing: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function selectSession(sessionId: string) {
    if (!client) return;
    try {
      setSelectedId(sessionId);
      setEvents(await client.events(sessionId));
    } catch (selectError) {
      await handleClientError(selectError);
    }
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
    } catch (error) { await handleClientError(error); }
    finally { setBusy(false); }
  }

  async function sessionAction(action: 'reconnect' | 'stop') {
    if (!client || !selected) return;
    setBusy(true);
    try {
      const result = await client[action](selected.id);
      if (!result.ok) throw new Error(`Could not ${action} this session.`);
      await refresh(client, selected.id);
    } catch (error) { await handleClientError(error); }
    finally { setBusy(false); }
  }

  async function decide(approvalId: string, decision: 'approve' | 'reject') {
    if (!client) return;
    setBusy(true);
    try {
      const result = await client.decide(approvalId, decision);
      if (!result.ok) throw new Error(`Could not ${decision} this request.`);
      await refresh();
    } catch (error) { await handleClientError(error); }
    finally { setBusy(false); }
  }

  async function forgetDevice() {
    setBusy(true);
    try {
      await clearPairing();
      resetClientState();
      setError(null);
    } catch (forgetError) {
      setError(`Could not remove the saved pairing: ${(forgetError as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!client) {
    return (
      <main className="connect-shell">
        <section className="connect-card" aria-labelledby="connect-title">
          <div className="mark">C</div>
          <p className="eyebrow">Consiglio mobile</p>
          <h1 id="connect-title">Your agents, within reach.</h1>
          {restoring ? (
            <div className="restore-state" role="status"><span className="restore-spinner" />Unlocking secure pairing…</div>
          ) : (
            <>
              <p className="lede">Connect to the bridge running on your desktop. The bridge URL must be protected by HTTPS.</p>
              {hasSavedPairing && <button className="saved-pairing" type="button" onClick={() => void restoreSavedPairing()}>Retry saved pairing</button>}
              <button className="scan-pairing" type="button" disabled={busy} onClick={() => void scanPairing()}>{busy ? 'Opening camera…' : 'Scan desktop pairing code'}</button>
              <div className="pairing-divider"><span>or enter it manually</span></div>
              <form onSubmit={connect}>
                <label>Bridge URL<input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://consiglio.example.ts.net" required /></label>
                <label>Pairing token<input type="password" value={token} onChange={event => setToken(event.target.value)} minLength={32} autoComplete="off" required /></label>
                {error && <p className="error" role="alert">{error}</p>}
                <button className="primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect securely'}</button>
              </form>
              <p className="privacy-note">Your token is protected by Android Keystore or iOS Keychain and automatically restored after restart. It is never written to localStorage.</p>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header><div><p className="eyebrow">Consiglio</p><h1>{selected ? shortRepository(selected.repository) : 'No sessions'}</h1></div><button className="quiet" disabled={busy} onClick={() => void forgetDevice()}>Forget device</button></header>
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
