import { stagesReached, summarizeFunnel } from '../src/domain/funnel.js';

const app = (company, statuses, status = statuses.at(-1), appliedAt = new Date()) => ({ company, statuses, status, appliedAt });

describe('stagesReached', () => {
  it('only counts stages the application actually passed through', () => {
    expect([...stagesReached({ statuses: ['APPLIED', 'INTERVIEW', 'OFFER'], appliedAt: new Date() })].sort()).toEqual([
      'applied',
      'interview',
      'offer',
    ]);
  });

  it('treats a saved-only application as not applied', () => {
    expect(stagesReached({ statuses: ['SAVED'], appliedAt: null }).size).toBe(0);
  });

  it('counts an application as applied when it has an appliedAt date', () => {
    expect(stagesReached({ statuses: [], appliedAt: new Date() }).has('applied')).toBe(true);
  });
});

describe('summarizeFunnel', () => {
  const summary = summarizeFunnel([
    app('Amazon', ['APPLIED', 'OA', 'OA_COMPLETED', 'INTERVIEW', 'OFFER', 'ACCEPTED']),
    app('Google', ['APPLIED', 'INTERVIEW', 'REJECTED']),
    app('Uber', ['APPLIED', 'REJECTED']),
    app('Atlassian', ['APPLIED']),
    app('Flipkart', ['SAVED'], 'SAVED', null),
  ]);

  it('builds the funnel and conversion rates', () => {
    expect(summary.funnel).toEqual({ applied: 4, oa: 1, interview: 2, offer: 1 });
    expect(summary.conversion).toEqual({ appliedToOa: 0.25, appliedToInterview: 0.5, interviewToOffer: 0.5 });
    expect(summary.responseRate).toBe(0.75);
  });

  it('classifies outcomes by current status', () => {
    expect(summary.outcomes).toEqual({ active: 1, offers: 1, accepted: 1, rejected: 2, withdrawn: 0 });
  });

  it('ranks companies by volume, then by how far they got', () => {
    expect(summary.byCompany.map((c) => c.company)).toEqual(['Amazon', 'Google', 'Atlassian', 'Uber']);
    expect(summary.byCompany[0]).toEqual({ company: 'Amazon', applied: 1, oa: 1, interview: 1, offer: 1 });
  });

  it('returns null rates instead of dividing by zero', () => {
    const empty = summarizeFunnel([]);
    expect(empty.conversion).toEqual({ appliedToOa: null, appliedToInterview: null, interviewToOffer: null });
    expect(empty.responseRate).toBeNull();
  });
});
