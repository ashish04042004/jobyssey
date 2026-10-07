const DAY_MS = 24 * 60 * 60 * 1000;

export const ROLE_CATEGORIES = ['SDE', 'Backend', 'Frontend', 'Full Stack', 'Data', 'ML', 'DevOps', 'Android', 'iOS', 'Product', 'Other'];

export const EMPLOYMENT_TYPES = {
  FULL_TIME: 'Full-time',
  INTERNSHIP: 'Internship',
  INTERNSHIP_PPO: 'Internship + PPO',
};

export const STATUS_LABELS = {
  SAVED: 'Saved',
  APPLIED: 'Applied',
  OA: 'OA',
  OA_COMPLETED: 'OA done',
  INTERVIEW: 'Interviewing',
  OFFER: 'Offer',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

/** Button labels for moving an application into each status. */
export const TRANSITION_LABELS = {
  APPLIED: 'I applied',
  OA: 'Got an OA',
  OA_COMPLETED: 'Finished the OA',
  INTERVIEW: 'Interviewing',
  OFFER: 'Got an offer',
  ACCEPTED: 'Accept offer',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdraw',
};

export const NEGATIVE_STATUSES = new Set(['REJECTED', 'WITHDRAWN']);

export function formatDate(iso, withTime = false) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function timeAgo(iso, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function formatCtc(min, max) {
  if (min == null && max == null) return 'CTC not disclosed';
  if (min != null && max != null && min !== max) return `₹${min}–${max} LPA`;
  return `₹${max ?? min} LPA`;
}

/** Returns `{ label, urgent, closed }` for an application deadline. */
export function describeDeadline(iso, now = Date.now()) {
  if (!iso) return null;
  const due = new Date(iso);
  const diff = due.getTime() - now;
  if (diff < 0) return { label: 'Closed', urgent: false, closed: true };

  const days = Math.floor(diff / DAY_MS);
  const date = due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (diff < DAY_MS) {
    const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
    return { label: `Closes in ${hours}h`, urgent: true, closed: false };
  }
  if (days <= 3) return { label: `Closes in ${days} day${days === 1 ? '' : 's'}`, urgent: true, closed: false };
  return { label: `Apply by ${date}`, urgent: false, closed: false };
}

/** ISO string → value for <input type="datetime-local"> in the user's timezone. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}
