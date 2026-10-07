import { z } from 'zod';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'INTERNSHIP', 'INTERNSHIP_PPO'];
const currentYear = new Date().getUTCFullYear();

export const uuidParam = z.object({ id: z.uuid() });

const lpa = z.number().min(0).max(999);
const optionalText = (max) => z.string().trim().max(max).transform((v) => v || null).nullable();

const jobFields = {
  companyId: z.uuid(),
  companyName: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1, 'Title is required').max(120),
  roleCategory: z.string().trim().max(50).transform((v) => v || null).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  locations: z.array(z.string().trim().min(1).max(80)).max(10),
  isRemote: z.boolean(),
  ctcMinLpa: lpa.nullable(),
  ctcMaxLpa: lpa.nullable(),
  eligibility: optionalText(1000),
  graduationYears: z.array(z.number().int().min(currentYear - 5).max(currentYear + 6)).max(6),
  applicationDeadline: z.iso.datetime({ offset: true }).transform((v) => new Date(v)).nullable(),
  jobUrl: z
    .url({ protocol: /^https?$/, message: 'Enter a valid http(s) link' })
    .max(2000)
    .nullable()
    .or(z.literal('').transform(() => null)),
  description: optionalText(10_000),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
};

const ctcOrdered = (body) =>
  body.ctcMinLpa == null || body.ctcMaxLpa == null || body.ctcMinLpa <= body.ctcMaxLpa;
const ctcMessage = { message: 'Minimum CTC cannot exceed maximum CTC', path: ['ctcMaxLpa'] };

export const createJobSchema = z
  .object(jobFields)
  .partial()
  .required({ title: true })
  .strict()
  .refine((body) => body.companyId || body.companyName, {
    message: 'Provide companyId or companyName',
    path: ['companyName'],
  })
  .refine(ctcOrdered, ctcMessage);

export const updateJobSchema = z
  .object(jobFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')
  .refine(ctcOrdered, ctcMessage);

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));

export const listJobsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  location: z.string().trim().max(80).optional(),
  roleCategory: z.string().trim().max(50).optional(),
  employmentType: csv.pipe(z.array(z.enum(EMPLOYMENT_TYPES)).optional()),
  graduationYear: z.coerce.number().int().optional(),
  minCtc: z.coerce.number().min(0).max(999).optional(),
  includeExpired: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.enum(['match', 'deadline', 'recent']).default('match'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const companySearchQuery = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
