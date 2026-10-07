import { z } from 'zod';

export const INTERVIEW_TYPES = ['OA', 'TECHNICAL', 'HR', 'MANAGERIAL', 'GROUP_DISCUSSION', 'OTHER'];
export const INTERVIEW_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'];

const MAX_REMINDER_MINUTES = 7 * 24 * 60;

const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const optionalText = (max) => z.string().max(max).transform((v) => v.trim() || null).nullable();

const reminderOffsets = z
  .array(z.number().int().min(5).max(MAX_REMINDER_MINUTES))
  .max(5)
  .transform((offsets) => [...new Set(offsets)].sort((a, b) => b - a));

const fields = {
  type: z.enum(INTERVIEW_TYPES),
  title: optionalText(120),
  scheduledAt: dateTime,
  endsAt: dateTime.nullable(),
  meetingUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable(),
  notes: optionalText(5000),
  reminderOffsetsMinutes: reminderOffsets,
};

const endsAfterStart = (body) => !body.endsAt || !body.scheduledAt || body.endsAt > body.scheduledAt;
const endsAfterStartError = { message: 'Must be after the start time', path: ['endsAt'] };

export const createInterviewSchema = z
  .object({
    ...fields,
    title: fields.title.optional(),
    endsAt: fields.endsAt.optional(),
    meetingUrl: fields.meetingUrl.optional(),
    notes: fields.notes.optional(),
    reminderOffsetsMinutes: fields.reminderOffsetsMinutes.default([1440, 60]),
  })
  .strict()
  .refine(endsAfterStart, endsAfterStartError);

export const updateInterviewSchema = z
  .object({ ...fields, status: z.enum(INTERVIEW_STATUSES) })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')
  .refine(endsAfterStart, endsAfterStartError);

const csv = (values) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

export const listInterviewsQuery = z
  .object({
    from: dateTime.optional(),
    to: dateTime.optional(),
    status: csv(INTERVIEW_STATUSES),
    order: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must be before `to`', path: ['to'] });

const MAX_AGENDA_DAYS = 62;

export const agendaQuery = z
  .object({ from: dateTime, to: dateTime })
  .refine((q) => q.from <= q.to, { message: '`from` must be before `to`', path: ['to'] })
  .refine((q) => q.to - q.from <= MAX_AGENDA_DAYS * 86_400_000, { message: `Range is limited to ${MAX_AGENDA_DAYS} days`, path: ['to'] });
