import { useEffect, useState } from 'react';

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isImage: boolean;
};

type Preview =
  | { kind: 'image'; path: string; dataUrl: string }
  | { kind: 'text'; path: string; text: string };

interface Props {
  sessionId: string;
  onClose: () => void;
  onError: (message: string) => void;
}

export default function FileBrowser({ sessionId, onClose, onError }: Props) {
  const [directory, setDirectory] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setPreview(null);
    window.codexApi.listWorkspaceFiles(sessionId, directory)
      .then(setEntries)
      .catch((error: Error) => onError(error.message))
      .finally(() => setLoading(false));
  }, [directory, sessionId]);

  const openEntry = async (entry: FileEntry) => {
    if (entry.isDirectory) {
      setDirectory(entry.path);
      return;
    }
    setLoading(true);
    try {
      setPreview(await window.codexApi.readWorkspaceFile(sessionId, entry.path));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const parentDirectory = directory.split(/[\\/]/).slice(0, -1).join('/');

  return (
    <aside className="codex-files-pane">
      <div className="codex-files-header">
        <div>
          <strong>Files</strong>
          <span title={directory || '/'}>{directory || '/'}</span>
        </div>
        <button className="codex-icon-button" onClick={onClose} aria-label="Close files">×</button>
      </div>

      {preview ? (
        <div className="codex-file-preview">
          <button className="codex-file-back" onClick={() => setPreview(null)}>← Files</button>
          <div className="codex-file-preview-name">{preview.path}</div>
          {preview.kind === 'image' ? (
            <img src={preview.dataUrl} alt={preview.path} />
          ) : (
            <pre>{preview.text}</pre>
          )}
        </div>
      ) : (
        <div className="codex-file-list">
          {directory && (
            <button className="codex-file-row" onClick={() => setDirectory(parentDirectory)}>
              <span className="codex-file-icon">↰</span>
              <span>..</span>
            </button>
          )}
          {loading && <div className="codex-file-state">Loading…</div>}
          {!loading && entries.length === 0 && <div className="codex-file-state">No files</div>}
          {entries.map(entry => (
            <button key={entry.path} className="codex-file-row" onClick={() => void openEntry(entry)} title={entry.path}>
              <span className="codex-file-icon">{entry.isDirectory ? '▸' : entry.isImage ? '▧' : '·'}</span>
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
