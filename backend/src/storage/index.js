import { createLocalStorage } from './localStorage.js';
import { createSupabaseStorage } from './supabaseStorage.js';

/**
 * Object storage for documents. Both drivers expose the same shape:
 *
 *   createUploadUrl(key, { mimeType, sizeBytes, expiresInSec }) → { url, method, headers, expiresAt }
 *   stat(key)                                                   → { sizeBytes } | null
 *   createDownloadUrl(key, { filename, expiresInSec })          → { url, expiresAt }
 *   remove(key)
 *
 * Browsers upload and download directly with the signed URLs; the API only
 * hands them out and verifies the result.
 */
export function createStorage(env) {
  if (env.STORAGE_DRIVER === 'supabase') {
    return createSupabaseStorage({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_BUCKET });
  }
  return createLocalStorage({ dir: env.STORAGE_LOCAL_DIR, secret: env.JWT_ACCESS_SECRET });
}
