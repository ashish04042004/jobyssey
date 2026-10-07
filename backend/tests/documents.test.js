import request from 'supertest';
import { pruneStorage } from '../src/workers/maintenance.js';
import { apiAs, createTestContext, createUser, prisma } from './helpers/integration.js';

const ctx = createTestContext();
const api = (user) => apiAs(ctx.app, user);
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fakePdf = (size = 2048) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size - 9, 0x20)]);

let student;
let other;

beforeEach(async () => {
  await ctx.reset();
  student = await createUser('student@example.com');
  other = await createUser('other@example.com');
});
afterAll(() => ctx.close());

const requestUpload = (user, overrides = {}) =>
  api(user).post('/documents/upload-url', {
    label: 'Resume — Backend',
    type: 'RESUME',
    filename: 'resume.pdf',
    mimeType: PDF,
    sizeBytes: 2048,
    ...overrides,
  });

const put = (url, body, contentType = PDF) => request(ctx.app).put(url).set('Content-Type', contentType).send(body);

/** Runs the whole three-step upload and returns the READY document. */
async function upload(user, overrides = {}, bytes = fakePdf(overrides.sizeBytes ?? 2048)) {
  const { body } = await requestUpload(user, overrides);
  await put(body.data.uploadUrl, bytes, overrides.mimeType ?? PDF).expect(200);
  return (await api(user).post(`/documents/${body.data.document.id}/complete`)).body.data;
}

describe('upload flow', () => {
  it('requests a signed URL, accepts the bytes and marks the document READY', async () => {
    const res = await requestUpload(student);
    expect(res.status).toBe(201);
    const { document, uploadUrl, uploadMethod, uploadHeaders, expiresAt } = res.body.data;
    expect(document).toMatchObject({ status: 'PENDING', label: 'Resume — Backend', type: 'RESUME', sizeBytes: 2048 });
    expect(uploadMethod).toBe('PUT');
    expect(uploadHeaders['Content-Type']).toBe(PDF);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    expect((await api(student).get('/documents')).body.data).toEqual([]);

    await put(uploadUrl, fakePdf()).expect(200);
    const done = await api(student).post(`/documents/${document.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ id: document.id, status: 'READY', usedByApplications: 0 });

    const again = await api(student).post(`/documents/${document.id}/complete`);
    expect(again.body.data.status).toBe('READY');

    const list = await api(student).get('/documents');
    expect(list.body.data.map((d) => d.id)).toEqual([document.id]);
    expect(list.body.meta).toEqual({ limit: 20, maxBytes: 5 * 1024 * 1024 });
    expect(await prisma.auditLog.count({ where: { action: 'document.uploaded' } })).toBe(1);
  });

  it('refuses to complete before the file is uploaded', async () => {
    const { body } = await requestUpload(student);
    const res = await api(student).post(`/documents/${body.data.document.id}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UPLOAD_MISSING');
  });

  it('records the real size of the stored object', async () => {
    const doc = await upload(student, { sizeBytes: 4096 }, fakePdf(3000));
    expect(doc.sizeBytes).toBe(3000);
  });

  it('accepts DOCX', async () => {
    const doc = await upload(student, { filename: 'cover.docx', mimeType: DOCX, type: 'COVER_LETTER' }, Buffer.alloc(2048, 1));
    expect(doc).toMatchObject({ status: 'READY', type: 'COVER_LETTER', mimeType: DOCX });
  });

  it.each([
    ['an image', { filename: 'me.png', mimeType: 'image/png' }],
    ['a file over 5 MB', { sizeBytes: 5 * 1024 * 1024 + 1 }],
    ['an empty file', { sizeBytes: 0 }],
    ['a mismatched extension', { filename: 'resume.docx' }],
    ['a missing label', { label: '  ' }],
  ])('rejects %s', async (_name, overrides) => {
    const res = await requestUpload(student, overrides);
    expect(res.status).toBe(400);
    expect(await prisma.document.count()).toBe(0);
  });

  it('caps each user at 20 documents', async () => {
    await prisma.document.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        userId: student.id,
        label: `Resume ${i}`,
        filename: 'r.pdf',
        mimeType: PDF,
        sizeBytes: 10,
        storageKey: `users/${student.id}/seed-${i}.pdf`,
        status: 'READY',
      })),
    });
    const res = await requestUpload(student);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_LIMIT_REACHED');
    expect((await requestUpload(other)).status).toBe(201);
  });
});

describe('signed URLs', () => {
  it('enforces the declared type and size, and can only be used once', async () => {
    const { body } = await requestUpload(student, { sizeBytes: 1000 });
    const url = body.data.uploadUrl;
    expect((await put(url, fakePdf(1000), DOCX)).status).toBe(415);
    expect((await put(url, fakePdf(1500))).status).toBe(413);
    expect((await put(url, fakePdf(1000))).status).toBe(200);
    const again = await put(url, fakePdf(1000));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_UPLOADED');
  });

  it('rejects tampered tokens and wrong operations', async () => {
    const { body } = await requestUpload(student);
    const url = body.data.uploadUrl;
    expect((await put(`${url.slice(0, -2)}xx`, fakePdf())).status).toBe(403);
    expect((await request(ctx.app).get(url)).status).toBe(403);
  });

  it('serves the file through a short-lived download URL', async () => {
    const bytes = fakePdf();
    const doc = await upload(student, {}, bytes);
    const link = await api(student).get(`/documents/${doc.id}/download-url`);
    expect(link.status).toBe(200);
    const file = await request(ctx.app).get(link.body.data.url).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe(PDF);
    expect(file.headers['content-disposition']).toContain("filename*=UTF-8''resume.pdf");
    expect(Buffer.compare(file.body, bytes)).toBe(0);
  });
});

describe('managing documents', () => {
  it('keeps documents private to their owner', async () => {
    const doc = await upload(student);
    expect((await api(other).get(`/documents/${doc.id}/download-url`)).status).toBe(404);
    expect((await api(other).patch(`/documents/${doc.id}`, { label: 'Mine' })).status).toBe(404);
    expect((await api(other).delete(`/documents/${doc.id}`)).status).toBe(404);
    expect((await api(other).post(`/documents/${doc.id}/complete`)).status).toBe(404);
    expect((await api(other).get('/documents')).body.data).toEqual([]);
  });

  it('renames and retypes', async () => {
    const doc = await upload(student);
    const res = await api(student).patch(`/documents/${doc.id}`, { label: 'Resume — Backend v2', type: 'OTHER' });
    expect(res.body.data).toMatchObject({ label: 'Resume — Backend v2', type: 'OTHER' });
    expect((await api(student).patch(`/documents/${doc.id}`, {})).status).toBe(400);
  });

  it('filters by type', async () => {
    await upload(student);
    await upload(student, { label: 'Cover', type: 'COVER_LETTER' });
    const res = await api(student).get('/documents?type=COVER_LETTER');
    expect(res.body.data.map((d) => d.label)).toEqual(['Cover']);
  });

  it('attaches a resume to an application and survives its deletion', async () => {
    const admin = await createUser('admin@example.com', 'ADMIN');
    const job = (await api(admin).post('/jobs', { companyName: 'Amazon', title: 'SDE I', locations: ['Gurugram'] })).body.data;
    const doc = await upload(student);
    const application = (await api(student).post('/applications', { jobId: job.id, status: 'APPLIED', resumeId: doc.id })).body.data;
    expect(application.resumeId).toBe(doc.id);
    expect((await api(student).get('/documents')).body.data[0].usedByApplications).toBe(1);

    expect((await api(other).post('/applications', { jobId: job.id, resumeId: doc.id })).status).toBe(400);

    expect((await api(student).delete(`/documents/${doc.id}`)).status).toBe(204);
    const stored = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(await ctx.storage.stat(stored.storageKey)).toBeNull();

    const detail = (await api(student).get(`/applications/${application.id}`)).body.data;
    expect(detail.resume).toMatchObject({ id: doc.id, label: 'Resume — Backend', deleted: true });
    expect((await api(student).get(`/documents/${doc.id}/download-url`)).status).toBe(404);
    expect((await api(student).patch(`/applications/${application.id}`, { resumeId: doc.id })).status).toBe(400);
    expect((await api(student).get('/documents')).body.data).toEqual([]);
  });
});

describe('pruning abandoned uploads', () => {
  it('drops PENDING documents older than a day, with their partial files', async () => {
    const { body } = await requestUpload(student);
    const fresh = await requestUpload(student, { label: 'Fresh' });
    await put(body.data.uploadUrl, fakePdf()).expect(200);
    const id = body.data.document.id;
    const { storageKey } = await prisma.document.findUnique({ where: { id } });
    await prisma.document.update({ where: { id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) } });

    const pruned = await pruneStorage({ prisma, storage: ctx.storage });
    expect(pruned.abandonedUploads).toBe(1);
    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
    expect(await ctx.storage.stat(storageKey)).toBeNull();
    expect(await prisma.document.findUnique({ where: { id: fresh.body.data.document.id } })).not.toBeNull();
  });
});
