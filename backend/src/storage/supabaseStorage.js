const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

/**
 * Supabase Storage over its REST API (private bucket, service-role key).
 * Signed upload URLs are single-use and expire after 2 hours on Supabase's
 * side; we advertise our own shorter expiry to clients.
 */
export function createSupabaseStorage({ url, serviceKey, bucket }) {
  const base = `${url.replace(/\/+$/, '')}/storage/v1`;
  const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

  async function call(path, init = {}) {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...auth, ...init.headers } });
    if (!response.ok && response.status !== 404 && response.status !== 400) {
      throw new Error(`Supabase Storage ${init.method ?? 'GET'} ${path} failed with ${response.status}`);
    }
    return response;
  }

  return {
    name: 'supabase',

    async createUploadUrl(key, { mimeType, expiresInSec }) {
      const response = await call(`/object/upload/sign/${bucket}/${encodeKey(key)}`, { method: 'POST' });
      if (!response.ok) throw new Error(`Supabase Storage refused an upload URL (${response.status})`);
      const { url: signedPath } = await response.json();
      return {
        url: `${base}${signedPath}`,
        method: 'PUT',
        headers: { 'Content-Type': mimeType, 'x-upsert': 'false' },
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      };
    },

    async stat(key) {
      const response = await call(`/object/info/${bucket}/${encodeKey(key)}`);
      if (!response.ok) return null;
      const info = await response.json();
      const size = Number(info.size ?? info.metadata?.size ?? info.metadata?.contentLength);
      return { sizeBytes: Number.isFinite(size) ? size : null };
    },

    async createDownloadUrl(key, { filename, expiresInSec }) {
      const response = await call(`/object/sign/${bucket}/${encodeKey(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSec }),
      });
      if (!response.ok) throw new Error(`Supabase Storage refused a download URL (${response.status})`);
      const { signedURL } = await response.json();
      const download = `download=${encodeURIComponent(filename)}`;
      return {
        url: `${base}${signedURL}${signedURL.includes('?') ? '&' : '?'}${download}`,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      };
    },

    async remove(key) {
      await call(`/object/${bucket}/${encodeKey(key)}`, { method: 'DELETE' });
    },
  };
}
