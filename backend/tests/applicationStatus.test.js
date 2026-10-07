import {
  ApplicationStatus as S,
  allowedTransitions,
  canTransition,
  isTerminal,
} from '../src/domain/applicationStatus.js';

describe('application state machine', () => {
  it.each([
    [S.SAVED, S.APPLIED],
    [S.APPLIED, S.OA],
    [S.APPLIED, S.INTERVIEW],
    [S.OA, S.OA_COMPLETED],
    [S.OA_COMPLETED, S.INTERVIEW],
    [S.INTERVIEW, S.OFFER],
    [S.OFFER, S.ACCEPTED],
    [S.APPLIED, S.REJECTED],
    [S.OA, S.REJECTED],
    [S.INTERVIEW, S.REJECTED],
    [S.OFFER, S.WITHDRAWN],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [S.APPLIED, S.OFFER],
    [S.SAVED, S.INTERVIEW],
    [S.OA, S.INTERVIEW],
    [S.OFFER, S.REJECTED],
    [S.REJECTED, S.APPLIED],
    [S.ACCEPTED, S.WITHDRAWN],
    [S.APPLIED, S.APPLIED],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('allows withdrawing from every non-terminal state', () => {
    for (const status of Object.values(S)) {
      if (!isTerminal(status)) expect(canTransition(status, S.WITHDRAWN)).toBe(true);
    }
  });

  it('treats ACCEPTED, REJECTED and WITHDRAWN as terminal', () => {
    expect(Object.values(S).filter(isTerminal).sort()).toEqual([S.ACCEPTED, S.REJECTED, S.WITHDRAWN].sort());
  });

  it('rejects unknown statuses', () => {
    expect(canTransition(S.SAVED, 'HIRED')).toBe(false);
    expect(() => allowedTransitions('HIRED')).toThrow(TypeError);
  });
});
