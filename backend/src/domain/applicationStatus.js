export const ApplicationStatus = Object.freeze({
  SAVED: 'SAVED',
  APPLIED: 'APPLIED',
  OA: 'OA',
  OA_COMPLETED: 'OA_COMPLETED',
  INTERVIEW: 'INTERVIEW',
  OFFER: 'OFFER',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
});

const S = ApplicationStatus;

// See docs/architecture.md §4 for the rationale behind each edge.
const TRANSITIONS = Object.freeze({
  [S.SAVED]: [S.APPLIED, S.WITHDRAWN],
  [S.APPLIED]: [S.OA, S.INTERVIEW, S.REJECTED, S.WITHDRAWN],
  [S.OA]: [S.OA_COMPLETED, S.REJECTED, S.WITHDRAWN],
  [S.OA_COMPLETED]: [S.INTERVIEW, S.REJECTED, S.WITHDRAWN],
  [S.INTERVIEW]: [S.OFFER, S.REJECTED, S.WITHDRAWN],
  [S.OFFER]: [S.ACCEPTED, S.WITHDRAWN],
  [S.ACCEPTED]: [],
  [S.REJECTED]: [],
  [S.WITHDRAWN]: [],
});

export const INITIAL_STATUSES = Object.freeze([S.SAVED, S.APPLIED]);

export function isValidStatus(status) {
  return Object.hasOwn(TRANSITIONS, status);
}

export function allowedTransitions(from) {
  if (!isValidStatus(from)) throw new TypeError(`Unknown application status: ${from}`);
  return TRANSITIONS[from];
}

export function canTransition(from, to) {
  return isValidStatus(to) && allowedTransitions(from).includes(to);
}

export function isTerminal(status) {
  return allowedTransitions(status).length === 0;
}
