import { matchesLocation, matchesRole, scoreJob } from '../src/domain/jobMatch.js';

const job = (overrides = {}) => ({
  title: 'Software Engineer',
  roleCategory: 'SDE',
  locations: ['Noida'],
  isRemote: false,
  graduationYears: [2026],
  ctcMinLpa: 18,
  ctcMaxLpa: 20,
  ...overrides,
});

const profile = (overrides = {}) => ({
  preferredRoles: ['SDE', 'Backend'],
  preferredLocations: ['Delhi NCR', 'Remote'],
  graduationYear: 2026,
  minCtcLpa: 15,
  ...overrides,
});

describe('scoreJob', () => {
  it('gives a perfect score when every signal matches', () => {
    expect(scoreJob(job(), profile())).toEqual({
      score: 100,
      breakdown: { role: 30, location: 25, graduation: 25, salary: 20 },
    });
  });

  it('scores zero for each signal that misses', () => {
    const result = scoreJob(
      job({ title: 'Product Manager', roleCategory: 'Product', locations: ['Pune'], graduationYears: [2025], ctcMaxLpa: 10, ctcMinLpa: 8 }),
      profile(),
    );
    expect(result).toEqual({ score: 0, breakdown: { role: 0, location: 0, graduation: 0, salary: 0 } });
  });

  it('gives half credit when the student has no preference or the job has no data', () => {
    const result = scoreJob(
      job({ ctcMinLpa: null, ctcMaxLpa: null }),
      profile({ preferredRoles: [], preferredLocations: [], minCtcLpa: null }),
    );
    expect(result.breakdown).toEqual({ role: 15, location: 12, graduation: 25, salary: 10 });
  });

  it('treats an empty graduation-year list as open to everyone', () => {
    expect(scoreJob(job({ graduationYears: [] }), profile({ graduationYear: 2030 })).breakdown.graduation).toBe(25);
  });

  it('falls back to minimum CTC when there is no maximum', () => {
    expect(scoreJob(job({ ctcMaxLpa: null, ctcMinLpa: 16 }), profile()).breakdown.salary).toBe(20);
  });
});

describe('matchesRole', () => {
  it.each([
    ['SDE', { title: 'Software Engineer', roleCategory: null }],
    ['SDE', { title: 'MTS', roleCategory: null }],
    ['Backend', { title: 'Backend Developer', roleCategory: null }],
    ['ML', { title: 'Machine Learning Engineer', roleCategory: null }],
    ['Full Stack', { title: 'Engineer', roleCategory: 'Full Stack' }],
  ])('%s matches %o', (role, j) => {
    expect(matchesRole(j, role)).toBe(true);
  });

  it('does not match substrings inside other words', () => {
    expect(matchesRole({ title: 'HTML Developer', roleCategory: null }, 'ML')).toBe(false);
  });
});

describe('matchesLocation', () => {
  it.each([
    ['Delhi NCR', ['Noida']],
    ['Delhi NCR', ['Gurgaon, Haryana']],
    ['Bengaluru', ['Bangalore']],
    ['Noida', ['Gurugram']],
  ])('%s matches %o', (wanted, locations) => {
    expect(matchesLocation({ locations, isRemote: false }, wanted)).toBe(true);
  });

  it('matches remote jobs for students who want remote', () => {
    expect(matchesLocation({ locations: [], isRemote: true }, 'Remote')).toBe(true);
    expect(matchesLocation({ locations: [], isRemote: true }, 'Pune')).toBe(false);
  });
});
