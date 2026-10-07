// Sample data for local development only: npm run db:seed:dev
import { env } from '../src/config/env.js';
import { prisma } from '../src/models/prisma.js';
import { slugify } from '../src/services/company.service.js';
import { hashPassword } from '../src/utils/password.js';

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed sample data with NODE_ENV=production.');
  process.exit(1);
}

const ADMIN = { email: 'admin@jobyssey.dev', password: 'admin-password-123' };
const YEAR = new Date().getUTCFullYear();
const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const NOTE = 'Sample listing for local development — not a real opening.';

const JOBS = [
  { company: 'Microsoft', title: 'Software Engineer', roleCategory: 'SDE', locations: ['Noida', 'Hyderabad'], ctc: [20, 24], deadline: 8 },
  { company: 'Adobe', title: 'Member of Technical Staff', roleCategory: 'SDE', locations: ['Noida', 'Bengaluru'], ctc: [18, 21], deadline: 12 },
  { company: 'Amazon', title: 'SDE I', roleCategory: 'SDE', locations: ['Delhi', 'Bengaluru'], ctc: [22, 28], deadline: 5 },
  { company: 'Atlassian', title: 'Backend Engineer', roleCategory: 'Backend', locations: ['Bengaluru'], remote: true, ctc: [30, 35], deadline: 15 },
  { company: 'Razorpay', title: 'Frontend Engineer', roleCategory: 'Frontend', locations: ['Bengaluru'], ctc: [16, 20], deadline: 20 },
  { company: 'Zomato', title: 'Data Analyst', roleCategory: 'Data', locations: ['Gurugram'], ctc: [12, 14], deadline: 10 },
  { company: 'Flipkart', title: 'SDE Intern', roleCategory: 'SDE', type: 'INTERNSHIP_PPO', locations: ['Bengaluru'], ctc: null, deadline: 3 },
  { company: 'Google', title: 'Software Engineer, Early Career', roleCategory: 'SDE', locations: ['Bengaluru', 'Hyderabad'], ctc: [32, 40], deadline: 25 },
  { company: 'Postman', title: 'Platform Engineer', roleCategory: 'DevOps', locations: ['Bengaluru'], remote: true, ctc: [20, 24], deadline: 18 },
  { company: 'Swiggy', title: 'Machine Learning Engineer', roleCategory: 'ML', locations: ['Bengaluru'], ctc: [24, 30], deadline: 9 },
];

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { role: 'ADMIN' },
    create: {
      email: ADMIN.email,
      passwordHash: await hashPassword(ADMIN.password),
      role: 'ADMIN',
      name: 'Jobyssey Admin',
      college: 'Jobyssey',
      branch: 'Ops',
      graduationYear: YEAR,
    },
  });

  let created = 0;
  for (const job of JOBS) {
    const slug = slugify(job.company);
    const company = await prisma.company.upsert({ where: { slug }, update: {}, create: { name: job.company, slug } });
    const exists = await prisma.job.findFirst({ where: { companyId: company.id, title: job.title, visibility: 'PUBLIC' } });
    if (exists) continue;

    await prisma.job.create({
      data: {
        companyId: company.id,
        createdById: admin.id,
        visibility: 'PUBLIC',
        title: job.title,
        roleCategory: job.roleCategory,
        employmentType: job.type ?? 'FULL_TIME',
        locations: job.locations,
        isRemote: Boolean(job.remote),
        ctcMinLpa: job.ctc?.[0] ?? null,
        ctcMaxLpa: job.ctc?.[1] ?? null,
        graduationYears: [YEAR, YEAR + 1],
        eligibility: 'B.Tech/B.E. in CS, IT, ECE or related branches. Minimum 7.0 CGPA.',
        applicationDeadline: inDays(job.deadline),
        description: NOTE,
      },
    });
    created += 1;
  }

  console.log(`Seeded ${created} sample job(s). Admin login: ${ADMIN.email} / ${ADMIN.password}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
