import { STATUS_LABELS } from '../../lib/format.js';

export const STATUS_TONES = {
  SAVED: 'bg-slate-100 text-slate-700',
  APPLIED: 'bg-sky-50 text-sky-700',
  OA: 'bg-amber-50 text-amber-800',
  OA_COMPLETED: 'bg-amber-50 text-amber-800',
  INTERVIEW: 'bg-violet-50 text-violet-700',
  OFFER: 'bg-emerald-50 text-emerald-700',
  ACCEPTED: 'bg-emerald-600 text-white',
  REJECTED: 'bg-rose-50 text-rose-700',
  WITHDRAWN: 'bg-slate-100 text-slate-500',
};

export const STATUS_DOTS = {
  SAVED: 'bg-slate-400',
  APPLIED: 'bg-sky-500',
  OA: 'bg-amber-500',
  OA_COMPLETED: 'bg-amber-500',
  INTERVIEW: 'bg-violet-500',
  OFFER: 'bg-emerald-500',
  ACCEPTED: 'bg-emerald-600',
  REJECTED: 'bg-rose-500',
  WITHDRAWN: 'bg-slate-300',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
