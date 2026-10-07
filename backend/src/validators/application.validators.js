import { z } from 'zod';
import { ApplicationStatus } from '../domain/applicationStatus.js';

const STATUSES = Object.values(ApplicationStatus);
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// Students back-date events ("I applied on Oct 2"), but never into the future.
const occurredAt = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now() + CLOCK_SKEW_MS, 'Date cannot be in the future');

const notes = z.string().max(5000).transform((v) => v.trim() || null).nullable();

export const createApplicationSchema = z
  .object({
    jobId: z.uuid(),
    status: z.enum([ApplicationStatus.SAVED, ApplicationStatus.APPLIED]).default(ApplicationStatus.SAVED),
    appliedAt: occurredAt.optional(),
    resumeId: z.uuid().nullable().optional(),
    notes: notes.optional(),
  })
  .strict();

export const updateApplicationSchema = z
  .object({ notes, resumeId: z.uuid().nullable() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

export const changeStatusSchema = z
  .object({
    status: z.enum(STATUSES),
    note: z.string().trim().max(1000).optional(),
    occurredAt: occurredAt.optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));

export const listApplicationsQuery = z.object({
  status: csv.pipe(z.array(z.enum(STATUSES)).optional()),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['updated', 'deadline', 'company']).default('updated'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const createPrepItemSchema = z.object({ topic: z.string().trim().min(1).max(80) }).strict();

export const updatePrepItemSchema = z
  .object({ topic: z.string().trim().min(1).max(80), isDone: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
