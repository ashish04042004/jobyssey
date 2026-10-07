import { Router } from 'express';

/** Signed-URL endpoints of the local storage driver. Auth is the token itself. */
export function storageRoutes({ storage }) {
  const router = Router();

  router.put('/:token', async (req, res) => {
    const { sizeBytes } = await storage.receive(req.params.token, req);
    res.json({ data: { sizeBytes } });
  });

  router.get('/:token', async (req, res) => {
    const file = await storage.open(req.params.token);
    res.set({
      'Content-Type': file.mimeType ?? 'application/octet-stream',
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename ?? 'download')}`,
      'Cache-Control': 'private, no-store',
    });
    file.stream.pipe(res);
  });

  return router;
}
