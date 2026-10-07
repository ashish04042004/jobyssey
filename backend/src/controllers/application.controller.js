import { z } from 'zod';
import { notFound } from '../utils/errors.js';
import {
  changeStatusSchema,
  createApplicationSchema,
  createPrepItemSchema,
  listApplicationsQuery,
  updateApplicationSchema,
  updatePrepItemSchema,
} from '../validators/application.validators.js';

const params = z.object({ id: z.uuid(), itemId: z.uuid().optional() });

function ids(req) {
  const parsed = params.safeParse(req.params);
  if (!parsed.success) throw notFound('Not found');
  return parsed.data;
}

export function createApplicationController({ applicationService }) {
  return {
    async create(req, res) {
      const { application, created } = await applicationService.create(req.user, createApplicationSchema.parse(req.body), req);
      res.status(created ? 201 : 200).json({ data: application });
    },

    async list(req, res) {
      res.json(await applicationService.list(req.user, listApplicationsQuery.parse(req.query)));
    },

    async get(req, res) {
      res.json({ data: await applicationService.get(req.user, ids(req).id) });
    },

    async update(req, res) {
      const { id } = ids(req);
      res.json({ data: await applicationService.update(req.user, id, updateApplicationSchema.parse(req.body), req) });
    },

    async changeStatus(req, res) {
      const { id } = ids(req);
      res.json({ data: await applicationService.changeStatus(req.user, id, changeStatusSchema.parse(req.body), req) });
    },

    async remove(req, res) {
      await applicationService.remove(req.user, ids(req).id, req);
      res.status(204).end();
    },

    async listPrep(req, res) {
      res.json({ data: await applicationService.listPrep(req.user, ids(req).id) });
    },

    async addPrep(req, res) {
      const { id } = ids(req);
      res.status(201).json({ data: await applicationService.addPrep(req.user, id, createPrepItemSchema.parse(req.body)) });
    },

    async updatePrep(req, res) {
      const { id, itemId } = ids(req);
      res.json({ data: await applicationService.updatePrep(req.user, id, itemId, updatePrepItemSchema.parse(req.body)) });
    },

    async removePrep(req, res) {
      const { id, itemId } = ids(req);
      await applicationService.removePrep(req.user, id, itemId);
      res.status(204).end();
    },
  };
}
