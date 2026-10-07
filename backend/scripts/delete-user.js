/**
 * Permanently deletes an account and everything it owns (its private jobs,
 * applications, documents incl. stored files, audit trail). Public jobs it
 * published stay, with the creator cleared.
 *
 *   npm run user:delete -- someone@example.com
 */
import { prisma } from '../src/models/prisma.js';
import { env } from '../src/config/env.js';
import { createStorage } from '../src/storage/index.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run user:delete -- <email>');
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
if (!user) {
  console.error(`No account for ${email}`);
  process.exit(1);
}

const storage = createStorage(env);
const documents = await prisma.document.findMany({ where: { userId: user.id }, select: { storageKey: true } });
for (const { storageKey } of documents) await storage.remove(storageKey).catch(() => {});

const [applications, jobs] = await Promise.all([
  prisma.application.findMany({ where: { userId: user.id }, select: { id: true } }),
  prisma.job.findMany({ where: { createdById: user.id, visibility: 'PRIVATE' }, select: { id: true } }),
]);
const aggregateIds = [...applications, ...jobs].map((row) => row.id);

await prisma.$transaction([
  prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } }),
  prisma.auditLog.deleteMany({ where: { actorId: user.id } }),
  prisma.application.deleteMany({ where: { userId: user.id } }),
  prisma.job.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } }),
  prisma.user.delete({ where: { id: user.id } }),
]);
console.log(`Deleted ${email} (${applications.length} applications, ${jobs.length} jobs, ${documents.length} documents)`);
await prisma.$disconnect();
