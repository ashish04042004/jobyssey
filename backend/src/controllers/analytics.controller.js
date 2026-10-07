import { applicationsAnalyticsQuery, dashboardQuery } from '../validators/analytics.validators.js';

export function createAnalyticsController({ analyticsService }) {
  return {
    async dashboard(req, res) {
      res.json({ data: await analyticsService.dashboard(req.user, dashboardQuery.parse(req.query)) });
    },

    async applications(req, res) {
      res.json({ data: await analyticsService.applications(req.user, applicationsAnalyticsQuery.parse(req.query)) });
    },
  };
}
