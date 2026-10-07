import { jest } from '@jest/globals';
import { createSupabaseStorage } from '../src/storage/supabaseStorage.js';

const storage = createSupabaseStorage({ url: 'https://proj.supabase.co/', serviceKey: 'service-role-key-0123456789', bucket: 'documents' });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let calls;
beforeEach(() => {
  calls = [];
  jest.spyOn(globalThis, 'fetch');
});
afterEach(() => jest.restoreAllMocks());

function respond(...responses) {
  globalThis.fetch.mockImplementation(async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body });
    return responses.shift();
  });
}

it('creates signed upload URLs with the service key', async () => {
  respond(json({ url: '/object/upload/sign/documents/users/u1/a.pdf?token=abc' }));
  const upload = await storage.createUploadUrl('users/u1/a.pdf', { mimeType: 'application/pdf', expiresInSec: 900 });
  expect(calls[0]).toMatchObject({ url: 'https://proj.supabase.co/storage/v1/object/upload/sign/documents/users/u1/a.pdf', method: 'POST' });
  expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer service-role-key-0123456789', apikey: 'service-role-key-0123456789' });
  expect(upload).toMatchObject({
    url: 'https://proj.supabase.co/storage/v1/object/upload/sign/documents/users/u1/a.pdf?token=abc',
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
  });
});

it('reads object size and treats missing objects as null', async () => {
  respond(json({ size: 1234 }), json({ error: 'not_found' }, 404), json({ error: 'not_found' }, 400));
  expect(await storage.stat('users/u1/a.pdf')).toEqual({ sizeBytes: 1234 });
  expect(calls[0].url).toBe('https://proj.supabase.co/storage/v1/object/info/documents/users/u1/a.pdf');
  expect(await storage.stat('users/u1/missing.pdf')).toBeNull();
  expect(await storage.stat('users/u1/missing.pdf')).toBeNull();
});

it('signs download URLs that force the original filename', async () => {
  respond(json({ signedURL: '/object/sign/documents/users/u1/a.pdf?token=xyz' }));
  const link = await storage.createDownloadUrl('users/u1/a.pdf', { filename: 'My CV.pdf', expiresInSec: 300 });
  expect(JSON.parse(calls[0].body)).toEqual({ expiresIn: 300 });
  expect(link.url).toBe('https://proj.supabase.co/storage/v1/object/sign/documents/users/u1/a.pdf?token=xyz&download=My%20CV.pdf');
});

it('surfaces server errors', async () => {
  respond(new Response('boom', { status: 500 }));
  await expect(storage.remove('users/u1/a.pdf')).rejects.toThrow(/failed with 500/);
});
