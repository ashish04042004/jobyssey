import { useState } from 'react';
import { fromLocalInput, INTERVIEW_TYPES, REMINDER_OPTIONS, toLocalInput } from '../../lib/format.js';
import { api, ApiError } from '../../services/api.js';
import { Alert, Button, Field, Input, Select } from '../ui.jsx';

const TEXTAREA =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

function initialValues(interview) {
  return {
    type: interview?.type ?? 'TECHNICAL',
    title: interview?.title ?? '',
    scheduledAt: toLocalInput(interview?.scheduledAt),
    endsAt: toLocalInput(interview?.endsAt),
    meetingUrl: interview?.meetingUrl ?? '',
    notes: interview?.notes ?? '',
    reminderOffsetsMinutes: interview?.reminderOffsetsMinutes ?? [1440, 60],
  };
}

/**
 * Schedules a new round (pass `applicationId`, or `applications` to pick one)
 * or edits an existing one (pass `interview`).
 */
export default function InterviewForm({ interview, applicationId, applications, onSaved, onCancel }) {
  const [values, setValues] = useState(() => initialValues(interview));
  const [chosenApplication, setChosenApplication] = useState(applicationId ?? '');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const isOa = values.type === 'OA';

  const set = (key) => (e) => setValues((prev) => ({ ...prev, [key]: e.target.value }));
  const toggleReminder = (minutes) =>
    setValues((prev) => ({
      ...prev,
      reminderOffsetsMinutes: prev.reminderOffsetsMinutes.includes(minutes)
        ? prev.reminderOffsetsMinutes.filter((m) => m !== minutes)
        : [...prev.reminderOffsetsMinutes, minutes],
    }));

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!interview && !chosenApplication) nextErrors.application = 'Pick the application this round belongs to';
    if (!values.scheduledAt) nextErrors.scheduledAt = 'When is it?';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const body = {
      type: values.type,
      title: values.title,
      endsAt: fromLocalInput(values.endsAt),
      meetingUrl: values.meetingUrl.trim() || null,
      notes: values.notes,
      reminderOffsetsMinutes: values.reminderOffsetsMinutes,
    };
    // The input has minute precision; only send the start when it actually changed.
    if (!interview || values.scheduledAt !== toLocalInput(interview.scheduledAt)) {
      body.scheduledAt = fromLocalInput(values.scheduledAt);
    }

    setSaving(true);
    setFormError(null);
    try {
      const { data } = interview
        ? await api.interviews.update(interview.id, body)
        : await api.interviews.schedule(chosenApplication, body);
      onSaved(data);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4" noValidate>
      {applications && !interview && (
        <Field label="Application" error={errors.application}>
          <Select value={chosenApplication} onChange={(e) => setChosenApplication(e.target.value)} error={errors.application}>
            <option value="">Choose a company…</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.job.company.name} — {a.job.title}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" error={errors.type}>
          <Select value={values.type} onChange={set('type')}>
            {Object.entries(INTERVIEW_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title (optional)" error={errors.title}>
          <Input value={values.title} onChange={set('title')} maxLength={120} placeholder={isOa ? 'e.g. HackerRank OA' : 'e.g. Round 1 — DSA'} />
        </Field>
        <Field label={isOa ? 'Opens at' : 'Starts at'} error={errors.scheduledAt}>
          <Input type="datetime-local" value={values.scheduledAt} onChange={set('scheduledAt')} error={errors.scheduledAt} />
        </Field>
        <Field label={isOa ? 'Due by (optional)' : 'Ends at (optional)'} error={errors.endsAt}>
          <Input type="datetime-local" value={values.endsAt} min={values.scheduledAt} onChange={set('endsAt')} error={errors.endsAt} />
        </Field>
      </div>

      <Field label={isOa ? 'Test link (optional)' : 'Meeting link (optional)'} error={errors.meetingUrl}>
        <Input type="url" value={values.meetingUrl} onChange={set('meetingUrl')} placeholder="https://" error={errors.meetingUrl} />
      </Field>

      <Field label="Notes (optional)" error={errors.notes}>
        <textarea
          rows={3}
          value={values.notes}
          onChange={set('notes')}
          maxLength={5000}
          placeholder="Interviewer, topics to revise, instructions from the recruiter…"
          className={TEXTAREA}
        />
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Remind me before</legend>
        <div className="flex flex-wrap gap-2">
          {REMINDER_OPTIONS.map(({ minutes, label }) => {
            const on = values.reminderOffsetsMinutes.includes(minutes);
            return (
              <button
                key={minutes}
                type="button"
                aria-pressed={on}
                onClick={() => toggleReminder(minutes)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {errors.reminderOffsetsMinutes && <p className="mt-1 text-xs text-rose-600">{errors.reminderOffsetsMinutes}</p>}
      </fieldset>

      {formError && <Alert>{formError}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          {interview ? 'Save changes' : 'Schedule'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
