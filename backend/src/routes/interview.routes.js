import { Router } from 'express';
import { createInterviewController } from '../controllers/interview.controller.js';

export function interviewRoutes({ interviewService }) {
  const controller = createInterviewController({ interviewService });
  const router = Router();

  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);

  return router;
}

export function agendaRoutes({ interviewService }) {
  const controller = createInterviewController({ interviewService });
  const router = Router();
  router.get('/', controller.agenda);
  return router;
}
