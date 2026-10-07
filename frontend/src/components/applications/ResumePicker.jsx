import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { downloadDocument } from '../documents/DocumentRow.jsx';
import { Select } from '../ui.jsx';
import { DOCUMENT_TYPES } from '../../lib/format.js';
import { api } from '../../services/api.js';

/** "Which resume did I send?" — picks one of the user's documents for an application. */
export default function ResumePicker({ application, onSaved }) {
  const [documents, setDocuments] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.documents
      .list({}, controller.signal)
      .then(({ data }) => setDocuments(data))
      .catch((err) => err.name !== 'AbortError' && setError(err.message));
    return () => controller.abort();
  }, []);

  const change = async (resumeId) => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.applications.update(application.id, { resumeId: resumeId || null });
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const current = application.resume;
  if (documents === null && !error) return <p className="text-sm text-slate-500">Loading…</p>;

  if (documents?.length === 0 && !current) {
    return (
      <p className="text-sm text-slate-500">
        <Link to="/documents" className="font-medium text-indigo-600 hover:text-indigo-500">
          Upload a resume
        </Link>{' '}
        to record which version you sent.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Select value={current && !current.deleted ? current.id : ''} onChange={(e) => change(e.target.value)} disabled={saving} aria-label="Resume used">
        <option value="">{current?.deleted ? `${current.label} (deleted)` : 'None selected'}</option>
        {Object.entries(DOCUMENT_TYPES).map(([type, label]) => {
          const options = (documents ?? []).filter((d) => d.type === type);
          return (
            options.length > 0 && (
              <optgroup key={type} label={label}>
                {options.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.label}
                  </option>
                ))}
              </optgroup>
            )
          );
        })}
      </Select>
      {current && !current.deleted && (
        <button
          type="button"
          onClick={() => downloadDocument(current.id).catch((err) => setError(err.message))}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
        >
          Download {current.filename}
        </button>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
