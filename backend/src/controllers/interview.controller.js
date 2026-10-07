import { z } from 'zod';
import { notFound } from '../utils/errors.js';
import {
  agendaQuery,
  createInterviewSchema,
  listInterviewsQuery,
  updateInterviewSchema,
} from '../validators/interview.validators.js';

const idParam = z.object({ id: z.uuid() });

function id(req) {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) throw notFound('Not found');
  return parsed.data.id;
}

export function createInterviewController({ interviewService }) {
  return {
    async schedule(req, res) {
      const body = createInterviewSchema.parse(req.body);
      res.status(201).json({ data: await interviewService.schedule(req.user, id(req), body, req) });
    },

    async list(req, res) {
      res.json(await interviewService.list(req.user, listInterviewsQuery.parse(req.query)));
    },

    async get(req, res) {
      res.json({ data: await interviewService.get(req.user, id(req)) });
    },

    async update(req, res) {
      const interviewId = id(req);
      res.json({ data: await interviewService.update(req.user, interviewId, updateInterviewSchema.parse(req.body), req) });
    },

    async remove(req, res) {
      await interviewService.remove(req.user, id(req), req);
      res.status(204).end();
    },

    async agenda(req, res) {
      res.json({ data: await interviewService.agenda(req.user, agendaQuery.parse(req.query)) });
    },
  };
}
