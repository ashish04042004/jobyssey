import { z } from 'zod';

const failedQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const jobParams = z.object({ queue: z.string().max(50), jobId: z.string().min(1).max(200) });

export function createAdminController({ adminService }) {
  return {
    async metrics(req, res) {
      res.json({ data: await adminService.metrics() });
    },

    async failedJobs(req, res) {
      const { limit } = failedQuery.parse(req.query);
      res.json({ data: await adminService.failedJobs(req.params.queue, { limit }) });
    },

    async retryJob(req, res) {
      const { queue, jobId } = jobParams.parse(req.params);
      res.json({ data: await adminService.retryJob(queue, jobId) });
    },
  };
}
