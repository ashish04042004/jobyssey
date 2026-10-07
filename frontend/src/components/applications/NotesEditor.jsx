import { useState } from 'react';
import { api } from '../../services/api.js';
import { Button } from '../ui.jsx';

const TEXTAREA =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

export default function NotesEditor({ application, onSaved }) {
  const [value, setValue] = useState(application.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const dirty = value.trim() !== (application.notes ?? '');

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { data } = await api.applications.update(application.id, { notes: value });
      setValue(data.notes ?? '');
      onSaved(data);
      setStatus('Saved');
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        rows={6}
        value={value}
        maxLength={5000}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus(null);
        }}
        placeholder="Referral contact, recruiter name, questions asked, salary discussion…"
        className={TEXTAREA}
        aria-label="Notes"
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs ${status === 'Saved' ? 'text-emerald-600' : 'text-rose-600'}`}>{status}</span>
        <Button variant="secondary" loading={saving} disabled={!dirty} onClick={save} className="px-3 py-1.5">
          Save notes
        </Button>
      </div>
    </div>
  );
}
