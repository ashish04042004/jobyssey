// Usage: npm run user:set-role -- <email> <STUDENT|ADMIN>
import { prisma } from '../src/models/prisma.js';

const [email, role] = process.argv.slice(2);
const ROLES = ['STUDENT', 'ADMIN'];

if (!email || !ROLES.includes(role)) {
  console.error('Usage: npm run user:set-role -- <email> <STUDENT|ADMIN>');
  process.exit(1);
}

try {
  const user = await prisma.user.update({ where: { email: email.trim().toLowerCase() }, data: { role } });
  console.log(`${user.email} is now ${user.role}. It takes effect on their next token refresh (within 15 minutes).`);
} catch (err) {
  console.error(err.code === 'P2025' ? `No user with email ${email}` : err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
