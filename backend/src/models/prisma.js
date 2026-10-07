import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });

export const prisma = new PrismaClient({
  adapter,
  // Query errors surface through our own error handling; Prisma's 'error' log
  // would also print expected ones such as handled unique-constraint races.
  log: ['warn'],
});
