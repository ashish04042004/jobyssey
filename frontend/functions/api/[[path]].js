/**
 * Cloudflare Pages Function: forwards `/api/*` to the API on Render.
 *
 * The browser only ever talks to the Pages origin, so the refresh-token cookie
 * is first-party (SameSite=Lax) instead of a third-party cookie that browsers
 * increasingly block. The visitor's address is passed on with a shared secret
 * so the API's per-IP rate limits still see real clients.
 *
 * Configure in the Pages project: API_ORIGIN (e.g. https://jobyssey-api.onrender.com)
 * and PROXY_SECRET (same value as the API's PROXY_SECRET).
 */
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host'];

export async function onRequest({ request, env }) {
  if (!env.API_ORIGIN || !env.PROXY_SECRET) {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'API proxy is not configured' } }, { status: 503 });
  }

  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  headers.set('x-client-ip', request.headers.get('cf-connecting-ip') ?? '');
  headers.set('x-proxy-secret', env.PROXY_SECRET);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });
  } catch {
    return Response.json(
      { error: { code: 'UNAVAILABLE', message: 'The API is starting up or unreachable. Try again in a moment.' } },
      { status: 503 },
    );
  }
}
