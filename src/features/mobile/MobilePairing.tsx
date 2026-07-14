import { useEffect, useState } from 'react';

import { createMobilePairingUri } from '../../main/mobile-pairing-config';

type Props = {
  open: boolean;
  onClose: () => void;
  onNotice: (kind: 'info' | 'success' | 'error', message: string) => void;
};

export default function MobilePairing({ open, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<MobileBridgeStatus | null>(null);
  const [port, setPort] = useState('43117');
  const [publicUrl, setPublicUrl] = useState('');
  const [pairingToken, setPairingToken] = useState('');
  const [pairingUri, setPairingUri] = useState('');
  const [pairingQr, setPairingQr] = useState('');
  const [pairingQrError, setPairingQrError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const next = await window.codexApi.getMobileBridgeStatus();
    setStatus(next);
    setPort(String(next.port));
    setPublicUrl(next.publicUrl);
  }

  useEffect(() => {
    if (!open) {
      setPairingToken('');
      return;
    }
    void refresh().catch(error => onNotice('error', `Could not read mobile pairing status: ${(error as Error).message}`));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    setPairingUri('');
    setPairingQr('');
    setPairingQrError('');
    if (!pairingToken || !publicUrl.trim()) return;
    try {
      const uri = createMobilePairingUri(publicUrl, pairingToken);
      setPairingUri(uri);
      void import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(uri, {
          width: 228,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0d1117', light: '#ffffff' },
        }))
        .then(value => {
          if (!cancelled) setPairingQr(value);
        })
        .catch(() => {
          if (!cancelled) {
            setPairingQr('');
            setPairingQrError('Could not render the pairing code. Copy the pairing link or enter the values manually.');
          }
        });
    } catch {
      // The form and main process provide the actionable validation error on save.
    }
    return () => { cancelled = true; };
  }, [pairingToken, publicUrl]);

  if (!open) return null;

  const config = () => ({ port: Number.parseInt(port, 10), publicUrl: publicUrl.trim() });

  async function enable() {
    setBusy(true);
    try {
      const result = await window.codexApi.enableMobileBridge(config());
      setStatus(result.status);
      setPort(String(result.status.port));
      setPublicUrl(result.status.publicUrl);
      if (result.token) setPairingToken(result.token);
      onNotice('success', result.token ? 'Mobile pairing enabled. Copy the token now.' : 'Mobile bridge settings saved.');
    } catch (error) {
      onNotice('error', `Could not enable mobile pairing: ${(error as Error).message}`);
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      const result = await window.codexApi.rotateMobileBridgeToken(config());
      setStatus(result.status);
      setPort(String(result.status.port));
      setPublicUrl(result.status.publicUrl);
      setPairingToken(result.token || '');
      onNotice('success', 'The old mobile token was revoked. Copy the replacement now.');
    } catch (error) {
      onNotice('error', `Could not rotate mobile pairing: ${(error as Error).message}`);
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const next = await window.codexApi.disableMobileBridge();
      setStatus(next);
      setPairingToken('');
      onNotice('success', 'Mobile pairing disabled and the pairing token revoked.');
    } catch (error) {
      onNotice('error', `Could not disable mobile pairing: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    if (!value) return;
    const copied = await window.codexApi.copyText(value);
    onNotice(copied ? 'success' : 'error', copied ? `${label} copied.` : `Could not copy ${label.toLowerCase()}.`);
  }

  const environmentManaged = status?.managedBy === 'environment';
  const canManage = status?.secureStorageAvailable && !environmentManaged;
  const stateColor = status?.running ? '#3fb950' : status?.enabled ? '#d29922' : '#8b949e';

  return (
    <div className="codex-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="codex-modal-card mobile-pairing-card" role="dialog" aria-modal="true" aria-labelledby="mobile-pairing-title" onMouseDown={event => event.stopPropagation()}>
        <header className="mobile-pairing-header">
          <div>
            <span className="codex-kicker">Android & iOS</span>
            <h2 id="mobile-pairing-title">Mobile pairing</h2>
          </div>
          <button className="codex-button codex-button-secondary" onClick={onClose}>Close</button>
        </header>

        {!status ? <p className="mobile-pairing-muted">Reading secure bridge status…</p> : (
          <div className="mobile-pairing-content">
            <div className="mobile-pairing-status" role="status" aria-live="polite">
              <span className="mobile-pairing-dot" style={{ background: stateColor }} />
              <strong>{status.running ? 'Bridge running' : status.enabled ? 'Bridge needs attention' : 'Bridge disabled'}</strong>
              <span>127.0.0.1:{status.port}</span>
            </div>

            <p className="mobile-pairing-muted">
              Consiglio listens only on this computer. Put an authenticated HTTPS tunnel or reverse proxy in front of the loopback port, then enter that HTTPS address below.
            </p>

            {environmentManaged && (
              <div className="mobile-pairing-callout">
                This launch is managed by <code>CONSIGLIO_MOBILE_BRIDGE_TOKEN</code>. Restart without that variable to manage pairing here.
              </div>
            )}

            {!status.secureStorageAvailable && !environmentManaged && (
              <div className="mobile-pairing-callout danger">
                Secure storage is unavailable ({status.secureStorageBackend}). Unlock or configure the operating-system keyring, then restart Consiglio.
              </div>
            )}

            {status.error && <div className="mobile-pairing-callout danger">{status.error}</div>}

            <label className="mobile-pairing-field">
              <span>HTTPS mobile URL</span>
              <input className="codex-input" type="url" value={publicUrl} onChange={event => setPublicUrl(event.target.value)} placeholder="https://consiglio.example.ts.net" disabled={!canManage || busy} />
              <small>Optional until your TLS tunnel is ready. Consiglio never binds directly to this address.</small>
            </label>

            <label className="mobile-pairing-field">
              <span>Loopback port</span>
              <input className="codex-input" type="number" min="1" max="65535" value={port} onChange={event => setPort(event.target.value)} disabled={!canManage || busy} />
            </label>

            {pairingToken && (
              <div className="mobile-pairing-token" role="status" aria-live="polite">
                <div>
                  <strong>One-time pairing token</strong>
                  <span>It will disappear when this dialog closes.</span>
                </div>
                <code>{pairingToken}</code>
                {pairingUri && (
                  <div className={`mobile-pairing-qr${pairingQr ? '' : ' no-image'}`}>
                    {pairingQr && <img src={pairingQr} alt="Consiglio mobile pairing QR code" />}
                    <div>
                      <strong>Scan with Consiglio mobile</strong>
                      <span>The code contains this one-time token. Keep it private and close this dialog when pairing is complete.</span>
                      <button className="codex-button codex-button-secondary" onClick={() => void copy(pairingUri, 'Pairing link')}>Copy pairing link</button>
                    </div>
                  </div>
                )}
                {!publicUrl.trim() && <span className="mobile-pairing-qr-hint">Add the public HTTPS URL to generate a scannable pairing code.</span>}
                {pairingQrError && <span className="mobile-pairing-qr-hint">{pairingQrError}</span>}
                <div className="mobile-pairing-actions">
                  <button className="codex-button codex-button-primary" onClick={() => void copy(pairingToken, 'Pairing token')}>Copy token</button>
                  {publicUrl.trim() && (
                    <button className="codex-button codex-button-secondary" onClick={() => void copy(JSON.stringify({ endpoint: publicUrl.trim(), token: pairingToken }, null, 2), 'Pairing configuration')}>Copy configuration</button>
                  )}
                </div>
              </div>
            )}

            <div className="mobile-pairing-actions mobile-pairing-footer">
              {!status.enabled ? (
                <button className="codex-button codex-button-primary" disabled={!canManage || busy} onClick={() => void enable()}>{busy ? 'Enabling…' : 'Enable & create token'}</button>
              ) : !environmentManaged && (
                <>
                  <button className="codex-button codex-button-primary" disabled={!canManage || busy} onClick={() => void enable()}>{busy ? 'Saving…' : 'Save settings'}</button>
                  <button className="codex-button codex-button-secondary" disabled={!canManage || busy} onClick={() => void rotate()}>Rotate token</button>
                  <button className="codex-button codex-button-danger" disabled={busy} onClick={() => void disable()}>Disable & revoke</button>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
