import { apiAs, createTestContext, createUser, prisma } from './helpers/integration.js';

const ctx = createTestContext();
const api = (user) => apiAs(ctx.app, user);
const DAY = 24 * 60 * 60 * 1000;

let admin;
let student;
let apps;

async function track(company, path) {
  const job = (await api(admin).post('/jobs', { companyName: company, title: 'SDE', locations: ['Bengaluru'] })).body.data;
  const [first, ...rest] = path;
  const created = (await api(student).post('/applications', { jobId: job.id, status: first })).body.data;
  for (const status of rest) {
    const res = await api(student).patch(`/applications/${created.id}/status`, { status });
    if (res.status !== 200) throw new Error(`${company}: ${status} → ${res.status} ${JSON.stringify(res.body)}`);
  }
  return created;
}

beforeEach(async () => {
  await ctx.reset();
  admin = await createUser('admin@example.com', 'ADMIN');
  student = await createUser('student@example.com');
  apps = {
    amazon: await track('Amazon', ['APPLIED', 'OA', 'OA_COMPLETED', 'INTERVIEW', 'OFFER']),
    google: await track('Google', ['APPLIED', 'INTERVIEW', 'REJECTED']),
    uber: await track('Uber', ['APPLIED', 'REJECTED']),
    atlassian: await track('Atlassian', ['APPLIED']),
    flipkart: await track('Flipkart', ['SAVED']),
  };
  await api(student).post(`/applications/${apps.atlassian.id}/interviews`, {
    type: 'TECHNICAL',
    scheduledAt: new Date(Date.now() + 2 * DAY).toISOString(),
  });
});
afterAll(() => ctx.close());

describe('GET /analytics/applications', () => {
  it('computes the funnel from application events', async () => {
    const res = await api(student).get('/analytics/applications?tz=Asia/Kolkata');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.funnel).toEqual({ applied: 4, oa: 1, interview: 2, offer: 1 });
    expect(data.conversion).toEqual({ appliedToOa: 0.25, appliedToInterview: 0.5, interviewToOffer: 0.5 });
    expect(data.responseRate).toBe(0.75);
    expect(data.outcomes).toEqual({ active: 2, offers: 1, accepted: 0, rejected: 2, withdrawn: 0 });
    expect(data.byCompany.map((c) => c.company)).toEqual(['Amazon', 'Google', 'Atlassian', 'Uber']);
    expect(data.range.tz).toBe('Asia/Kolkata');
  });

  it('returns a zero-filled monthly series ending this month', async () => {
    const { monthly } = (await api(student).get('/analytics/applications?months=3')).body.data;
    expect(monthly).toHaveLength(3);
    const thisMonth = new Date().toISOString().slice(0, 7);
    expect(monthly.at(-1)).toEqual({ month: thisMonth, applications: 4, interviews: 1, offers: 1 });
    expect(monthly[0]).toMatchObject({ applications: 0, interviews: 0, offers: 0 });
  });

  it('filters the cohort by date range', async () => {
    await prisma.application.update({ where: { id: apps.uber.id }, data: { appliedAt: new Date(Date.now() - 60 * DAY) } });
    const from = new Date(Date.now() - 30 * DAY).toISOString();
    const recent = (await api(student).get(`/analytics/applications?from=${from}`)).body.data;
    expect(recent.funnel.applied).toBe(3);
    const none = (await api(student).get(`/analytics/applications?from=${new Date(Date.now() + DAY).toISOString()}`)).body.data;
    expect(none.funnel).toEqual({ applied: 0, oa: 0, interview: 0, offer: 0 });
  });

  it('only sees the caller’s own applications', async () => {
    const other = await createUser('other@example.com');
    const data = (await api(other).get('/analytics/applications')).body.data;
    expect(data.funnel.applied).toBe(0);
    expect(data.byCompany).toEqual([]);
  });

  it.each([['tz=Mars/Olympus'], ['months=0'], ['months=30'], ['from=2026-10-01&to=2026-09-01']])('rejects %s', async (query) => {
    expect((await api(student).get(`/analytics/applications?${query}`)).status).toBe(400);
  });
});

describe('GET /analytics/dashboard', () => {
  it('summarizes the pipeline, this month, the next week and stale applications', async () => {
    await prisma.application.update({
      where: { id: apps.atlassian.id },
      data: { statusChangedAt: new Date(Date.now() - 20 * DAY) },
    });
    const res = await api(student).get('/analytics/dashboard?tz=Asia/Kolkata');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.pipeline).toEqual({ OFFER: 1, REJECTED: 2, APPLIED: 1, SAVED: 1 });
    expect(data.thisMonth).toEqual({ applications: 4, interviews: 1, offers: 1 });
    expect(data.nextSevenDays).toEqual({ interviews: 1, deadlines: 0 });
    expect(data.staleApplications).toEqual([
      expect.objectContaining({ id: apps.atlassian.id, company: 'Atlassian', status: 'APPLIED', daysSinceUpdate: 20 }),
    ]);
  });

  it('is cached, and invalidated by the user’s own changes', async () => {
    const first = (await api(student).get('/analytics/dashboard')).body.data;

    await prisma.application.update({ where: { id: apps.atlassian.id }, data: { status: 'WITHDRAWN' } });
    const cached = (await api(student).get('/analytics/dashboard')).body.data;
    expect(cached).toEqual(first);

    await api(student).patch(`/applications/${apps.flipkart.id}/status`, { status: 'APPLIED' });
    const fresh = (await api(student).get('/analytics/dashboard')).body.data;
    expect(fresh.pipeline).toMatchObject({ APPLIED: 1, WITHDRAWN: 1 });
    expect(fresh.pipeline.SAVED).toBeUndefined();
  });
});
