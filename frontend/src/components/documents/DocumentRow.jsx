import { useState } from 'react';
import { Button, Input } from '../ui.jsx';
import { DOCUMENT_ACCEPT, formatBytes, timeAgo } from '../../lib/format.js';
import { api, storageUrl } from '../../services/api.js';

export async function downloadDocument(id) {
  const { data } = await api.documents.downloadUrl(id);
  window.location.assign(storageUrl(data.url));
}

export default function DocumentRow({ document, onChanged, onRemoved, onError }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(document.label);
  const [busy, setBusy] = useState(null);

  const run = async (action, fn) => {
    setBusy(action);
    try {
      await fn();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const rename = (event) => {
    event.preventDefault();
    const next = label.trim();
    if (!next || next === document.label) return setEditing(false);
    run('rename', async () => {
      const { data } = await api.documents.update(document.id, { label: next });
      onChanged(data);
      setEditing(false);
    });
  };

  const remove = () => {
    const used = document.usedByApplications;
    const warning = used ? ` It is attached to ${used} application${used === 1 ? '' : 's'}; they will show it as deleted.` : '';
    if (!window.confirm(`Delete “${document.label}”?${warning}`)) return;
    run('delete', async () => {
      await api.documents.remove(document.id);
      onRemoved(document.id);
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[11px] font-bold text-indigo-700">
        {DOCUMENT_ACCEPT[document.mimeType] ?? 'FILE'}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={rename} className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoFocus aria-label="Document name" />
            <Button type="submit" loading={busy === 'rename'} className="px-3 py-1.5">
              Save
            </Button>
          </form>
        ) : (
          <p className="truncate text-sm font-medium text-slate-900">{document.label}</p>
        )}
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {document.filename} · {formatBytes(document.sizeBytes)} · uploaded {timeAgo(document.createdAt)}
          {document.usedByApplications > 0 &&
            ` · used in ${document.usedByApplications} application${document.usedByApplications === 1 ? '' : 's'}`}
        </p>
      </div>
      {!editing && (
        <div className="flex gap-1">
          <Button variant="secondary" className="px-3 py-1.5" loading={busy === 'download'} onClick={() => run('download', () => downloadDocument(document.id))}>
            Download
          </Button>
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            loading={busy === 'delete'}
            onClick={remove}
            aria-label={`Delete ${document.label}`}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}
