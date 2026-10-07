/**
 * HTTP load test against a running API (default: the Docker stack on :4001).
 *
 *   npm run load:api -- --url http://localhost:4001 --duration 10 --connections 50
 *
 * Seeds throw-away students, runs each scenario with autocannon while rotating
 * users per request (so per-user rate limits are not what gets measured), prints
 * throughput and p50/p95/p99 latency, then deletes the seeded data.
 */
import autocannon from 'autocannon';
import { randomUUID } from 'node:crypto';
import { cleanup, options, prisma, printTable, seedUsers, summarize } from './common.js';

const opts = options({ url: 'http://localhost:4001', duration: 10, connections: 50, usersPerScenario: 500 });

const SCENARIOS = [
  { name: 'GET /health', path: () => '/api/health', anonymous: true },
  { name: 'GET /jobs (ranked)', path: () => '/api/jobs?limit=20' },
  { name: 'GET /applications', path: () => '/api/applications?limit=20' },
  { name: 'GET /analytics/dashboard (cached)', path: () => '/api/analytics/dashboard?tz=Asia%2FKolkata' },
  { name: 'GET /analytics/applications', path: () => '/api/analytics/applications?tz=Asia%2FKolkata' },
  {
    name: 'POST /jobs/:id/save (idempotent)',
    method: 'POST',
    path: (ctx) => `/api/jobs/${ctx.jobs[Math.floor(Math.random() * ctx.jobs.length)]}/save`,
    idempotent: true,
  },
];

function run(scenario, users, ctx) {
  let cursor = 0;
  const latencies = [];
  const statuses = {};

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: opts.url,
        connections: opts.connections,
        duration: opts.duration,
        requests: [
          {
            method: scenario.method ?? 'GET',
            setupRequest(req) {
              const user = users[cursor++ % users.length];
              return {
                ...req,
                path: scenario.path(ctx),
                headers: {
                  ...(scenario.anonymous ? {} : { authorization: `Bearer ${user.token}` }),
                  ...(scenario.idempotent ? { 'idempotency-key': randomUUID(), 'content-type': 'application/json' } : {}),
                },
                ...(scenario.method === 'POST' ? { body: '{}' } : {}),
              };
            },
          },
        ],
      },
      (err, result) => (err ? reject(err) : resolve({ result, latencies, statuses })),
    );
    instance.on('response', (_client, statusCode, _bytes, responseTime) => {
      latencies.push(responseTime);
      statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
    });
  });
}

const removed = await cleanup();
if (removed) console.log(`removed ${removed} leftover load-test users`);

console.log(`Seeding ${opts.usersPerScenario * SCENARIOS.length} users…`);
const users = await seedUsers(opts.usersPerScenario * SCENARIOS.length);
const jobs = (await prisma.job.findMany({ where: { visibility: 'PUBLIC', isActive: true }, select: { id: true } })).map((j) => j.id);
console.log(`Running ${SCENARIOS.length} scenarios × ${opts.duration}s at ${opts.connections} connections against ${opts.url}\n`);

const rows = [];
try {
  for (const [i, scenario] of SCENARIOS.entries()) {
    const pool = users.slice(i * opts.usersPerScenario, (i + 1) * opts.usersPerScenario);
    const { result, latencies, statuses } = await run(scenario, pool, { jobs });
    const ok = Object.entries(statuses).filter(([code]) => code < 400).reduce((sum, [, n]) => sum + n, 0);
    const total = latencies.length;
    const latency = summarize(latencies);
    rows.push({
      scenario: scenario.name,
      requests: total,
      'req/s': Math.round(result.requests.average),
      'p50 ms': latency.p50,
      'p95 ms': latency.p95,
      'p99 ms': latency.p99,
      errors: `${total - ok}${result.errors ? ` (+${result.errors} socket)` : ''}`,
    });
    console.log(`✓ ${scenario.name}: ${JSON.stringify(statuses)}`);
  }
} finally {
  const count = await cleanup();
  console.log(`\ncleaned up ${count} load-test users\n`);
  await prisma.$disconnect();
}

printTable(rows, ['scenario', 'requests', 'req/s', 'p50 ms', 'p95 ms', 'p99 ms', 'errors']);
