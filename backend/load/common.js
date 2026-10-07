import { parseArgs } from 'node:util';
import { prisma } from '../src/models/prisma.js';
import { signAccessToken } from '../src/utils/tokens.js';

export { prisma };

/** Every load-test account lives under this domain, so cleanup is one delete. */
export const LOAD_DOMAIN = '@load.jobyssey.test';
const DAY = 24 * 60 * 60 * 1000;

export function options(defaults) {
  const { values } = parseArgs({
    options: Object.fromEntries(Object.keys(defaults).map((key) => [key, { type: 'string' }])),
    allowPositionals: false,
  });
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, values[key] === undefined ? fallback : typeof fallback === 'number' ? Number(values[key]) : values[key]]),
  );
}

export async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: LOAD_DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return 0;
  const apps = await prisma.application.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: apps.map((a) => a.id) } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  const { count } = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return count;
}

/**
 * Creates `count` students, each tracking `appsPerUser` public jobs with a short
 * history, and returns them with signed access tokens.
 */
export async function seedUsers(count, { appsPerUser = 3 } = {}) {
  const jobs = await prisma.job.findMany({ where: { visibility: 'PUBLIC', isActive: true }, select: { id: true }, take: 50 });
  if (jobs.length < appsPerUser) throw new Error('Not enough public jobs. Run `npm run db:seed:dev` first.');

  const stamp = Date.now();
  await prisma.user.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      email: `user-${stamp}-${i}${LOAD_DOMAIN}`,
      passwordHash: 'load-test',
      name: `Load User ${i}`,
      college: 'Load Test Institute',
      branch: 'CSE',
      graduationYear: new Date().getUTCFullYear(),
      preferredRoles: ['SDE', 'Backend'],
      preferredLocations: ['Bengaluru'],
      skills: ['Node.js', 'PostgreSQL'],
    })),
  });
  const users = await prisma.user.findMany({ where: { email: { startsWith: `user-${stamp}-` } }, select: { id: true, role: true } });

  const applications = users.flatMap((user, u) =>
    Array.from({ length: appsPerUser }, (_, k) => ({
      userId: user.id,
      jobId: jobs[(u + k) % jobs.length].id,
      status: 'APPLIED',
      appliedAt: new Date(Date.now() - ((u + k) % 120) * DAY),
    })),
  );
  for (let i = 0; i < applications.length; i += 5000) {
    await prisma.application.createMany({ data: applications.slice(i, i + 5000), skipDuplicates: true });
  }
  const created = await prisma.application.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true, appliedAt: true } });
  for (let i = 0; i < created.length; i += 5000) {
    await prisma.applicationEvent.createMany({
      data: created.slice(i, i + 5000).map((a) => ({ applicationId: a.id, toStatus: 'APPLIED', occurredAt: a.appliedAt })),
    });
  }

  return Promise.all(users.map(async (user) => ({ ...user, token: await signAccessToken(user) })));
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return { p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted.at(-1) ?? null) };
}

export function printTable(rows, columns) {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => `| ${cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join(' | ')} |`;
  console.log(line(columns));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const row of rows) console.log(line(columns.map((c) => row[c])));
}
