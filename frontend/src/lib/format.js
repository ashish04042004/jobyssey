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
