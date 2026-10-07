import { Router } from 'express';
import { createCompanyService } from '../services/company.service.js';
import { companySearchQuery } from '../validators/job.validators.js';

export function companyRoutes({ prisma }) {
  const companyService = createCompanyService({ prisma });
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ data: await companyService.search(companySearchQuery.parse(req.query)) });
  });

  return router;
}
