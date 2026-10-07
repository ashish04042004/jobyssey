import { useState } from 'react';
import { Link } from 'react-router';
import { STATUS_LABELS } from '../../lib/format.js';
import { api } from '../../services/api.js';
import { Button } from '../ui.jsx';

export default function SaveJobButton({ job, onSaved, size = 'sm' }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const padding = size === 'sm' ? 'px-3 py-1.5' : '';

  if (job.application) {
    return (
      <Link
        to={`/applications/${job.application.id}`}
        title="Open in your tracker"
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-50 text-sm font-medium text-indigo-700 hover:bg-indigo-100 ${padding || 'px-4 py-2'}`}
      >
        ✓ {STATUS_LABELS[job.application.status]}
      </Link>
    );
  }

  const save = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.jobs.save(job.id);
      onSaved?.({ id: data.id, status: data.status });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="secondary" loading={saving} onClick={save} className={padding}>
        Save
      </Button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}
