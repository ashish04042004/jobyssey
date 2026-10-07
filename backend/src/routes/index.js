import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createApplicationService } from '../services/application.service.js';
import { createCache } from '../services/cache.service.js';
import { createInterviewService } from '../services/interview.service.js';
import { createJobService } from '../services/job.service.js';
import { applicationRoutes } from './application.routes.js';
import { authRoutes } from './auth.routes.js';
import { companyRoutes } from './company.routes.js';
import { healthRoutes } from './health.routes.js';
import { agendaRoutes, interviewRoutes } from './interview.routes.js';
import { jobRoutes } from './job.routes.js';
import { meRoutes } from './me.routes.js';

export function apiRoutes(deps) {
  const cache = createCache({ redis: deps.redis, logger: deps.logger });
  const jobService = createJobService({ prisma: deps.prisma, cache });
  const applicationService = createApplicationService({ prisma: deps.prisma, jobService });
  const interviewService = createInterviewService({ prisma: deps.prisma });
  const services = { ...deps, jobService, applicationService, interviewService };

  const router = Router();
  const protectedRoute = [
    authenticate,
    rateLimit({ redis: deps.redis, name: 'api', limit: 100, windowSec: 60, key: (req) => req.user.id }),
  ];

  router.use('/health', healthRoutes(deps));
  router.use('/auth', authRoutes(deps));
  router.use('/me', ...protectedRoute, meRoutes(deps));
  router.use('/jobs', ...protectedRoute, jobRoutes(services));
  router.use('/companies', ...protectedRoute, companyRoutes(deps));
  router.use('/applications', ...protectedRoute, applicationRoutes(services));
  router.use('/interviews', ...protectedRoute, interviewRoutes(services));
  router.use('/agenda', ...protectedRoute, agendaRoutes(services));

  return router;
}
