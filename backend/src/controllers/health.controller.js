export function createHealthController({ healthService, version }) {
  return {
    liveness(req, res) {
      res.json({
        data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()), version },
      });
    },

    async readiness(req, res) {
      const result = await healthService.readiness();
      res.status(result.status === 'ok' ? 200 : 503).json({ data: result });
    },
  };
}
