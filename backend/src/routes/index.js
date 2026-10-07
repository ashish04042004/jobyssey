import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createAdminService } from '../services/admin.service.js';
import { createAnalyticsService } from '../services/analytics.service.js';
import { createApplicationService } from '../services/application.service.js';
import { createCache } from '../services/cache.service.js';
import { createDocumentService } from '../services/document.service.js';
import { createInterviewService } from '../services/interview.service.js';
import { createJobService } from '../services/job.service.js';
import { createNotificationService } from '../services/notification.service.js';
import { adminRoutes } from './admin.routes.js';
import { analyticsRoutes } from './analytics.routes.js';
import { applicationRoutes } from './application.routes.js';
import { authRoutes } from './auth.routes.js';
import { companyRoutes } from './company.routes.js';
import { documentRoutes } from './document.routes.js';
import { healthRoutes } from './health.routes.js';
import { agendaRoutes, interviewRoutes } from './interview.routes.js';
import { jobRoutes } from './job.routes.js';
import { meRoutes } from './me.routes.js';
import { notificationRoutes } from './notification.routes.js';
import { storageRoutes } from './storage.routes.js';

/**
 * Wraps the named `(user, ...)` service methods so a successful call also
 * invalidates that user's cached dashboard.
 */
function invalidatingDashboard(service, methods, analyticsService) {
  const wrapped = { ...service };
  for (const name of methods) {
    wrapped[name] = async (user, ...args) => {
      const result = await service[name](user, ...args);
      await analyticsService.invalidate(user.id);
      return result;
    };
  }
  return wrapped;
}

export function apiRoutes(deps) {
  const cache = createCache({ redis: deps.redis, logger: deps.logger });
  const analyticsService = createAnalyticsService({ prisma: deps.prisma, cache });
  const jobService = createJobService({ prisma: deps.prisma, cache });
  const applicationService = invalidatingDashboard(
    createApplicationService({ prisma: deps.prisma, jobService }),
    ['create', 'update', 'changeStatus', 'remove'],
    analyticsService,
  );
  const interviewService = invalidatingDashboard(
    createInterviewService({ prisma: deps.prisma }),
    ['schedule', 'update', 'remove'],
    analyticsService,
  );
  const notificationService = createNotificationService({ prisma: deps.prisma });
  const documentService = createDocumentService({ prisma: deps.prisma, storage: deps.storage, logger: deps.logger });
  const adminService = createAdminService({ prisma: deps.prisma, redis: deps.redis, queues: deps.queues });
  const services = {
    ...deps,
    jobService,
    applicationService,
    interviewService,
    notificationService,
    documentService,
    analyticsService,
    adminService,
  };

  const router = Router();
  const protectedRoute = [
    authenticate,
    rateLimit({ redis: deps.redis, name: 'api', limit: 100, windowSec: 60, key: (req) => req.user.id }),
  ];

  router.use('/health', healthRoutes(deps));
  router.use('/auth', authRoutes(deps));
  if (deps.storage?.name === 'local') router.use('/storage', storageRoutes(deps));
  router.use('/me', ...protectedRoute, meRoutes(deps));
  router.use('/jobs', ...protectedRoute, jobRoutes(services));
  router.use('/companies', ...protectedRoute, companyRoutes(deps));
  router.use('/applications', ...protectedRoute, applicationRoutes(services));
  router.use('/interviews', ...protectedRoute, interviewRoutes(services));
  router.use('/agenda', ...protectedRoute, agendaRoutes(services));
  router.use('/notifications', ...protectedRoute, notificationRoutes(services));
  router.use('/documents', ...protectedRoute, documentRoutes(services));
  router.use('/analytics', ...protectedRoute, analyticsRoutes(services));
  router.use('/admin', ...protectedRoute, adminRoutes(services));

  return router;
}
