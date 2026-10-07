import { createJobSchema, listJobsQuery, updateJobSchema, uuidParam } from '../validators/job.validators.js';
import { notFound } from '../utils/errors.js';

function jobId(req) {
  const parsed = uuidParam.safeParse(req.params);
  if (!parsed.success) throw notFound('Job not found');
  return parsed.data.id;
}

export function createJobController({ jobService, applicationService }) {
  return {
    async list(req, res) {
      res.json(await jobService.list(req.user, listJobsQuery.parse(req.query)));
    },

    async get(req, res) {
      res.json({ data: await jobService.get(req.user, jobId(req)) });
    },

    async create(req, res) {
      const job = await jobService.create(req.user, createJobSchema.parse(req.body), req);
      res.status(201).json({ data: job });
    },

    async update(req, res) {
      const id = jobId(req);
      res.json({ data: await jobService.update(req.user, id, updateJobSchema.parse(req.body), req) });
    },

    async archive(req, res) {
      await jobService.archive(req.user, jobId(req), req);
      res.status(204).end();
    },

    async save(req, res) {
      const { application, created } = await applicationService.saveJob(req.user, jobId(req), req);
      res.status(created ? 201 : 200).json({ data: application });
    },
  };
}
