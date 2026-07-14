import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onNotice: (kind: 'info' | 'success' | 'error', message: string) => void;
};

const emptyForm: SecretInput = {
  label: '',
  envVar: '',
  value: '',
  scope: 'all',
  enabled: true,
};

export default function SecretsManager({ open, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<SecretsStatus | null>(null);
  const [form, setForm] = useState<SecretInput>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.codexApi.listSecrets()
      .then(setStatus)
      .catch((error: Error) => onNotice('error', `Could not load secrets: ${error.message}`));
  }, [open]);

  if (!open) return null;

  const resetForm = () => {
    setForm(emptyForm);
    setEditing(false);
  };

  const save = async () => {
    if (!form.envVar.trim() || (!editing && !form.value?.trim())) return;
    setSaving(true);
    try {
      const next = await window.codexApi.upsertSecret(form);
      setStatus(next);
      resetForm();
      onNotice('success', editing ? 'Credential updated. It will be used by the next task process.' : 'Credential saved for new task processes.');
    } catch (error) {
      onNotice('error', `Could not save credential: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const edit = (secret: SecretMetadata) => {
    setForm({
      id: secret.id,
      label: secret.label,
      envVar: secret.envVar,
      value: '',
      scope: secret.scope,
      enabled: secret.enabled,
    });
    setEditing(true);
  };

  const toggle = async (secret: SecretMetadata) => {
    try {
      setStatus(await window.codexApi.upsertSecret({
        id: secret.id,
        label: secret.label,
        envVar: secret.envVar,
        scope: secret.scope,
        enabled: !secret.enabled,
      }));
    } catch (error) {
      onNotice('error', `Could not update credential: ${(error as Error).message}`);
    }
  };

  const remove = async (secret: SecretMetadata) => {
    if (!window.confirm(`Remove ${secret.label}? This cannot be undone.`)) return;
    try {
      setStatus(await window.codexApi.removeSecret(secret.id));
      if (form.id === secret.id) resetForm();
      onNotice('info', `${secret.label} removed.`);
    } catch (error) {
      onNotice('error', `Could not remove credential: ${(error as Error).message}`);
    }
  };

  const copyMcpConfig = async (secret: SecretMetadata) => {
    const snippet = `# STDIO MCP server\nenv_vars = ["${secret.envVar}"]\n\n# Streamable HTTP MCP server\nbearer_token_env_var = "${secret.envVar}"`;
    await window.codexApi.copyText(snippet);
    onNotice('success', `MCP configuration for ${secret.envVar} copied.`);
  };

  return (
    <div className="codex-modal-backdrop" onClick={onClose}>
      <section className="codex-secrets-dialog" role="dialog" aria-modal="true" aria-labelledby="secrets-title" onClick={(event) => event.stopPropagation()}>
        <header className="codex-dialog-header">
          <div>
            <span className="codex-kicker">Credentials</span>
            <h2 id="secrets-title">API keys and MCP secrets</h2>
            <p>Saved values never return to the window. Enabled keys enter new task processes as environment variables.</p>
          </div>
          <button className="codex-button codex-button-secondary" onClick={onClose}>Close</button>
        </header>

        <div className={`codex-secret-security ${status?.secure ? 'is-secure' : 'is-warning'}`}>
          <span className="codex-secret-security-dot" />
          <span>
            {!status ? 'Checking operating-system credential storage…' : status.available
              ? status.secure ? `Encrypted with ${formatBackend(status.backend)}` : `Encrypted with ${formatBackend(status.backend)}; configure a desktop keyring for stronger protection`
              : 'Secure storage is unavailable; unlock or configure the operating-system keyring'}
          </span>
        </div>

        <div className="codex-secrets-layout">
          <div className="codex-secret-list" aria-label="Saved credentials">
            {status?.secrets.length === 0 && (
              <div className="codex-secret-empty">No credentials yet. Add a service key once and Consiglio will supply it to future tasks.</div>
            )}
            {status?.secrets.map((secret) => (
              <article className={`codex-secret-row${secret.enabled ? '' : ' is-disabled'}`} key={secret.id}>
                <div className="codex-secret-main">
                  <span className="codex-secret-name">{secret.label}</span>
                  <code>{secret.envVar}</code>
                  <span className="codex-secret-scope">{scopeLabel(secret.scope)}</span>
                </div>
                <div className="codex-secret-actions">
                  <button className="codex-button codex-button-secondary" onClick={() => void copyMcpConfig(secret)}>MCP config</button>
                  <button className="codex-button codex-button-secondary" onClick={() => edit(secret)}>Edit</button>
                  <button className="codex-button codex-button-secondary" onClick={() => void toggle(secret)}>{secret.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="codex-button codex-button-danger" onClick={() => void remove(secret)}>Remove</button>
                </div>
              </article>
            ))}
          </div>

          <form className="codex-secret-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <div className="codex-secret-form-title">{editing ? 'Update credential' : 'Add credential'}</div>
            <label>
              <span>Service name</span>
              <input className="codex-input" value={form.label} placeholder="Semantic Scholar" onChange={(event) => setForm({ ...form, label: event.target.value })} />
            </label>
            <label>
              <span>Environment variable</span>
              <input className="codex-input codex-secret-env-input" value={form.envVar} placeholder="SS_API_KEY" autoCapitalize="characters" spellCheck={false} onChange={(event) => setForm({ ...form, envVar: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
            </label>
            <label>
              <span>{editing ? 'Replacement value' : 'Secret value'}</span>
              <input className="codex-input" type="password" value={form.value || ''} autoComplete="new-password" placeholder={editing ? 'Leave blank to keep current value' : 'Paste API key'} onChange={(event) => setForm({ ...form, value: event.target.value })} />
            </label>
            <label>
              <span>Available to</span>
              <select className="codex-select" value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as SecretScope })}>
                <option value="all">All task providers</option>
                <option value="codex">Codex / OpenAI tasks</option>
                <option value="local">Local and LAN model tasks</option>
              </select>
            </label>
            <label className="codex-secret-check">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              <span>Inject into new task processes</span>
            </label>
            <div className="codex-secret-form-actions">
              {editing && <button type="button" className="codex-button codex-button-secondary" onClick={resetForm}>Cancel edit</button>}
              <button className="codex-button codex-button-primary" disabled={saving || !status?.available || !form.envVar.trim() || (!editing && !form.value?.trim())}>
                {saving ? 'Saving…' : editing ? 'Update' : 'Add credential'}
              </button>
            </div>
          </form>
        </div>

        <p className="codex-secret-note">
          MCP servers still need to reference the variable in Codex configuration. Isolated local-provider profiles intentionally do not load your normal MCP server list.
        </p>
      </section>
    </div>
  );
}

function formatBackend(backend: string) {
  return backend.replace(/_/g, ' ');
}

function scopeLabel(scope: SecretScope) {
  if (scope === 'codex') return 'Codex only';
  if (scope === 'local') return 'Local providers';
  return 'All providers';
}
