import { useState } from 'react';
import { fromLocalInput, NEGATIVE_STATUSES, STATUS_LABELS, toLocalInput, TRANSITION_LABELS } from '../../lib/format.js';
import { api, ApiError } from '../../services/api.js';
import { Alert, Button, Field, Input } from '../ui.jsx';

const NOTE_HINTS = {
  APPLIED: 'e.g. Applied via referral from a senior',
  OA: 'e.g. HackerRank, 90 minutes, due Friday',
  OA_COMPLETED: 'e.g. Solved 2/3, partial on the last one',
  INTERVIEW: 'e.g. Round 1 — DSA with the platform team',
  OFFER: 'e.g. ₹18 LPA base, joining July',
  ACCEPTED: 'e.g. Signed the offer letter',
  REJECTED: 'What happened? Useful when preparing for the next one',
  WITHDRAWN: 'Why are you dropping it?',
};

/**
 * Shows the moves the state machine allows from the current status. Sends the
 * loaded `version` so a change made in another tab is caught instead of
 * silently overwritten.
 */
export default function StatusChanger({ application, onChanged, onConflict }) {
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [whenEdited, setWhenEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const choose = (status) => {
    setTarget(status);
    setNote('');
    setWhen(toLocalInput(new Date().toISOString()));
    setWhenEdited(false);
    setError(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.applications.changeStatus(application.id, {
        status: target,
        note: note.trim() || undefined,
        // The input only has minute precision; leave "now" to the server unless the user back-dated it.
        occurredAt: whenEdited ? (fromLocalInput(when) ?? undefined) : undefined,
        expectedVersion: application.version,
      });
      setTarget(null);
      onChanged(data);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'VERSION_CONFLICT' || err.code === 'INVALID_TRANSITION')) {
        setTarget(null);
        onConflict();
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (application.allowedTransitions.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        This application is closed as <span className="font-medium">{STATUS_LABELS[application.status]}</span>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {application.allowedTransitions.map((status) => {
          const negative = NEGATIVE_STATUSES.has(status);
          const selected = target === status;
          return (
            <Button
              key={status}
              variant={negative ? 'secondary' : 'primary'}
              onClick={() => (selected ? setTarget(null) : choose(status))}
              aria-pressed={selected}
              className={`${selected ? 'ring-2 ring-indigo-500/40 ring-offset-1' : ''} ${negative ? 'text-slate-600' : ''}`}
            >
              {TRANSITION_LABELS[status]}
            </Button>
          );
        })}
      </div>

      {target && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            Move to <span className="font-semibold">{STATUS_LABELS[target]}</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Note (optional)">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={NOTE_HINTS[target]} autoFocus />
              </Field>
            </div>
            <Field label="When">
              <Input type="datetime-local" value={when} max={toLocalInput(new Date().toISOString())} onChange={(e) => {
                  setWhen(e.target.value);
                  setWhenEdited(true);
                }}
              />
            </Field>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" loading={saving}>
              Confirm
            </Button>
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
