import request from 'supertest';
import { signAccessToken } from '../src/utils/tokens.js';
import { createTestContext, prisma, validRegistration } from './helpers/integration.js';

const ctx = createTestContext();
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();
const YEAR = new Date().getUTCFullYear();

let admin;
let student;
let other;

async function createUser(email, role = 'STUDENT', profile = {}) {
  const { password: _password, ...fields } = validRegistration({ email });
  const user = await prisma.user.create({ data: { ...fields, passwordHash: 'x', role, ...profile } });
  return { ...user, auth: `Bearer ${await signAccessToken(user)}` };
}

const api = (user) => ({
  get: (path) => request(ctx.app).get(`/api${path}`).set('Authorization', user.auth),
  post: (path, body) => request(ctx.app).post(`/api${path}`).set('Authorization', user.auth).send(body),
  patch: (path, body) => request(ctx.app).patch(`/api${path}`).set('Authorization', user.auth).send(body),
  delete: (path) => request(ctx.app).delete(`/api${path}`).set('Authorization', user.auth),
});

async function publish(body) {
  const res = await api(admin).post('/jobs', body);
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeEach(async () => {
  await ctx.reset();
  admin = await createUser('admin@example.com', 'ADMIN');
  student = await createUser('student@example.com', 'STUDENT', {
    preferredRoles: ['SDE'],
    preferredLocations: ['Delhi NCR'],
    graduationYear: YEAR,
    minCtcLpa: 15,
  });
  other = await createUser('other@example.com');
});
afterAll(() => ctx.close());

describe('creating jobs', () => {
  it('lets admins publish a public job and finds-or-creates the company by name', async () => {
    const job = await publish({ companyName: 'Microsoft', title: 'Software Engineer', locations: ['Noida'] });
    const again = await publish({ companyName: '  microsoft ', title: 'Data Scientist' });

    expect(job).toMatchObject({ visibility: 'PUBLIC', company: { name: 'Microsoft', slug: 'microsoft' }, canEdit: true });
    expect(again.company.id).toBe(job.company.id);

    const outbox = await prisma.outboxEvent.findMany({ where: { type: 'job.published' } });
    expect(outbox).toHaveLength(2);
  });

  it('defaults students to private jobs and forbids publishing', async () => {
    const res = await api(student).post('/jobs', { companyName: 'Startup', title: 'SDE Intern' });
    expect(res.status).toBe(201);
    expect(res.body.data.visibility).toBe('PRIVATE');

    const publicAttempt = await api(student).post('/jobs', { companyName: 'Startup', title: 'SDE', visibility: 'PUBLIC' });
    expect(publicAttempt.status).toBe(403);
  });

  it('validates the body', async () => {
    const res = await api(admin).post('/jobs', {
      title: '',
      ctcMinLpa: 30,
      ctcMaxLpa: 20,
      jobUrl: 'javascript:alert(1)',
      unknownField: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('listing jobs', () => {
  it('shows public jobs plus only my own private jobs', async () => {
    await publish({ companyName: 'Microsoft', title: 'Software Engineer' });
    await api(student).post('/jobs', { companyName: 'Mine', title: 'My private job' });
    await api(other).post('/jobs', { companyName: 'Theirs', title: 'Their private job' });

    const titles = (await api(student).get('/jobs')).body.data.map((j) => j.title).sort();
    expect(titles).toEqual(['My private job', 'Software Engineer']);
  });

  it('ranks by match score and explains the score', async () => {
    await publish({ companyName: 'Acme', title: 'Product Manager', locations: ['Pune'], graduationYears: [YEAR - 1] });
    await publish({
      companyName: 'Microsoft',
      title: 'Software Engineer',
      roleCategory: 'SDE',
      locations: ['Noida'],
      graduationYears: [YEAR],
      ctcMinLpa: 18,
      ctcMaxLpa: 20,
    });

    const [first, second] = (await api(student).get('/jobs')).body.data;
    expect(first).toMatchObject({ title: 'Software Engineer', matchScore: 100 });
    expect(first.matchBreakdown).toEqual({ role: 30, location: 25, graduation: 25, salary: 20 });
    expect(second.matchScore).toBeLessThan(first.matchScore);
  });

  it('filters by text, synonym-aware location and minimum CTC', async () => {
    await publish({ companyName: 'Microsoft', title: 'SDE', locations: ['Gurgaon'], ctcMaxLpa: 25 });
    await publish({ companyName: 'Adobe', title: 'MTS', locations: ['Bangalore'], ctcMaxLpa: 18 });

    const titles = async (query) => (await api(student).get(`/jobs?${query}`)).body.data.map((j) => j.company.name);
    expect(await titles('q=adob')).toEqual(['Adobe']);
    expect(await titles('location=Delhi%20NCR')).toEqual(['Microsoft']);
    expect(await titles('location=Bengaluru')).toEqual(['Adobe']);
    expect((await titles('minCtc=20&sort=recent'))).toEqual(['Microsoft']);
  });

  it('hides jobs whose deadline has passed unless asked', async () => {
    await publish({ companyName: 'Old', title: 'Expired', applicationDeadline: inDays(-1) });
    await publish({ companyName: 'New', title: 'Open', applicationDeadline: inDays(3) });

    expect((await api(student).get('/jobs')).body.data.map((j) => j.title)).toEqual(['Open']);
    expect((await api(student).get('/jobs?includeExpired=true')).body.meta.total).toBe(2);
  });

  it('paginates with an opaque cursor', async () => {
    for (let i = 0; i < 5; i += 1) await publish({ companyName: `Company ${i}`, title: `Role ${i}` });

    const first = await api(student).get('/jobs?limit=2&sort=recent');
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.total).toBe(5);

    const second = await api(student).get(`/jobs?limit=2&sort=recent&cursor=${first.body.meta.nextCursor}`);
    const third = await api(student).get(`/jobs?limit=2&sort=recent&cursor=${second.body.meta.nextCursor}`);
    expect(third.body.data).toHaveLength(1);
    expect(third.body.meta.nextCursor).toBeNull();

    const all = [...first.body.data, ...second.body.data, ...third.body.data].map((j) => j.id);
    expect(new Set(all).size).toBe(5);

    expect((await api(student).get('/jobs?cursor=garbage')).status).toBe(400);
  });

  it('serves public jobs from cache and invalidates it when a public job changes', async () => {
    await publish({ companyName: 'Microsoft', title: 'SDE' });
    await api(student).get('/jobs');
    const cachedKeys = await ctx.redis.keys('jobyssey:cache:jobs:v[0-9]*:public:*');
    expect(cachedKeys).toHaveLength(1);

    // Bypass the API so only the cache can explain a stale read.
    await prisma.job.updateMany({ data: { title: 'Changed behind the cache' } });
    expect((await api(student).get('/jobs')).body.data[0].title).toBe('SDE');

    await publish({ companyName: 'Adobe', title: 'MTS' });
    const titles = (await api(student).get('/jobs')).body.data.map((j) => j.title).sort();
    expect(titles).toEqual(['Changed behind the cache', 'MTS']);
  });
});

describe('job detail and edits', () => {
  it('hides other students\u2019 private jobs behind a 404', async () => {
    const mine = (await api(other).post('/jobs', { companyName: 'Secret', title: 'Private' })).body.data;

    expect((await api(student).get(`/jobs/${mine.id}`)).status).toBe(404);
    expect((await api(admin).get(`/jobs/${mine.id}`)).status).toBe(404);
    expect((await api(student).get('/jobs/not-a-uuid')).status).toBe(404);
  });

  it('lets owners edit their private jobs but not students edit public ones', async () => {
    const publicJob = await publish({ companyName: 'Microsoft', title: 'SDE' });
    const mine = (await api(student).post('/jobs', { companyName: 'Startup', title: 'Intern' })).body.data;

    expect((await api(student).patch(`/jobs/${publicJob.id}`, { title: 'Hacked' })).status).toBe(403);
    expect((await api(student).patch(`/jobs/${mine.id}`, { visibility: 'PUBLIC' })).status).toBe(403);

    const edited = await api(student).patch(`/jobs/${mine.id}`, { title: 'SDE Intern', companyName: 'Startup Inc' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ title: 'SDE Intern', company: { name: 'Startup Inc' } });
  });

  it('archives jobs so they disappear from listings', async () => {
    const job = await publish({ companyName: 'Microsoft', title: 'SDE' });
    expect((await api(admin).delete(`/jobs/${job.id}`)).status).toBe(204);

    expect((await api(student).get('/jobs')).body.data).toHaveLength(0);
    expect((await api(student).get(`/jobs/${job.id}`)).status).toBe(404);
  });
});

describe('POST /api/jobs/:id/save', () => {
  it('creates a SAVED application once and returns it on repeat', async () => {
    const job = await publish({ companyName: 'Microsoft', title: 'SDE' });

    const first = await api(student).post(`/jobs/${job.id}/save`);
    const second = await api(student).post(`/jobs/${job.id}/save`);

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ jobId: job.id, status: 'SAVED' });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const events = await prisma.applicationEvent.findMany({ where: { applicationId: first.body.data.id } });
    expect(events).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'SAVED' })]);

    const listed = (await api(student).get('/jobs')).body.data[0];
    expect(listed.application).toEqual({ id: first.body.data.id, status: 'SAVED' });
  });

  it('handles concurrent double-clicks without duplicates', async () => {
    const job = await publish({ companyName: 'Microsoft', title: 'SDE' });
    const results = await Promise.all(Array.from({ length: 5 }, () => api(student).post(`/jobs/${job.id}/save`)));

    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await prisma.application.count()).toBe(1);
  });

  it('refuses to save jobs the user cannot see', async () => {
    const theirs = (await api(other).post('/jobs', { companyName: 'Secret', title: 'Private' })).body.data;
    expect((await api(student).post(`/jobs/${theirs.id}/save`)).status).toBe(404);
  });
});
