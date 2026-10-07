import { useState } from 'react';
import { Link } from 'react-router';
import { formatOffset, formatTime, INTERVIEW_TYPES } from '../../lib/format.js';
import { api } from '../../services/api.js';
import InterviewForm from './InterviewForm.jsx';

const LIST = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' });

const TYPE_TONES = {
  OA: 'bg-amber-50 text-amber-800',
  TECHNICAL: 'bg-violet-50 text-violet-700',
  HR: 'bg-sky-50 text-sky-700',
  MANAGERIAL: 'bg-indigo-50 text-indigo-700',
  GROUP_DISCUSSION: 'bg-teal-50 text-teal-700',
  OTHER: 'bg-slate-100 text-slate-700',
};

export function TypeBadge({ type }) {
  return <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_TONES[type]}`}>{INTERVIEW_TYPES[type]}</span>;
}

function ActionLink({ children, onClick, tone = 'text-slate-600 hover:text-slate-900' }) {
  return (
    <button type="button" onClick={onClick} className={`text-xs font-medium ${tone}`}>
      {children}
    </button>
  );
}

/**
 * One OA/interview round with its actions. `job` is shown when the card is
 * listed outside its application (agenda, interviews page).
 */
export default function InterviewCard({ interview, job, onChanged, onRemoved }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const past = new Date(interview.endsAt ?? interview.scheduledAt) < new Date();
  const scheduled = interview.status === 'SCHEDULED';

  const update = async (body) => {
    setError(null);
    try {
      const { data } = await api.interviews.update(interview.id, body);
      onChanged(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this round? Its reminders will be cancelled.')) return;
    try {
      await api.interviews.remove(interview.id);
      onRemoved(interview.id);
    } catch (err) {
      setError(err.message);
    }
  };

  if (editing) {
    return (
      <InterviewForm
        interview={interview}
        onCancel={() => setEditing(false)}
        onSaved={(data) => {
          setEditing(false);
          onChanged(data);
        }}
      />
    );
  }

  const time = interview.endsAt
    ? `${formatTime(interview.scheduledAt)} – ${formatTime(interview.endsAt)}`
    : formatTime(interview.scheduledAt);

  return (
    <div className={`flex gap-4 rounded-lg border border-slate-200 bg-white p-4 ${scheduled ? '' : 'opacity-70'}`}>
      <div className="w-20 shrink-0 text-sm">
        <p className={`font-semibold ${interview.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
          {formatTime(interview.scheduledAt)}
        </p>
        {interview.endsAt && <p className="text-xs text-slate-500">to {formatTime(interview.endsAt)}</p>}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {job && (
            <Link to={`/applications/${interview.applicationId}`} className="font-semibold text-slate-900 hover:text-indigo-700">
              {job.company.name}
            </Link>
          )}
          <TypeBadge type={interview.type} />
          {interview.status !== 'SCHEDULED' && (
            <span className="text-xs font-medium text-slate-500">{interview.status === 'COMPLETED' ? '✓ Done' : 'Cancelled'}</span>
          )}
        </div>
        <p className="text-sm text-slate-700">
          {interview.title || (job ? job.title : INTERVIEW_TYPES[interview.type])}
          <span className="sr-only"> at {time}</span>
        </p>
        {interview.notes && <p className="line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{interview.notes}</p>}
        {scheduled && !past && interview.reminderOffsetsMinutes.length > 0 && (
          <p className="text-xs text-slate-500">
            🔔 {LIST.format(interview.reminderOffsetsMinutes.map(formatOffset))} before
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
          {scheduled && past && (
            <ActionLink onClick={() => update({ status: 'COMPLETED' })} tone="text-emerald-700 hover:text-emerald-800">
              Mark done
            </ActionLink>
          )}
          <ActionLink onClick={() => setEditing(true)}>Edit</ActionLink>
          {scheduled && !past && (
            <ActionLink onClick={() => update({ status: 'CANCELLED' })}>Cancel round</ActionLink>
          )}
          {interview.status === 'CANCELLED' && !past && (
            <ActionLink onClick={() => update({ status: 'SCHEDULED' })}>Restore</ActionLink>
          )}
          <ActionLink onClick={remove} tone="text-rose-600 hover:text-rose-700">
            Delete
          </ActionLink>
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>

      {interview.meetingUrl && scheduled && (
        <a
          href={interview.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="h-fit shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {interview.type === 'OA' ? 'Open test ↗' : 'Join ↗'}
        </a>
      )}
    </div>
  );
}
