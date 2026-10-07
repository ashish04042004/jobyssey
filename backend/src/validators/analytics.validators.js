import { z } from 'zod';

function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const tz = z.string().max(64).refine(isTimeZone, 'Unknown time zone').default('UTC');
const date = z.iso.datetime({ offset: true }).or(z.iso.date()).transform((v) => new Date(v));

export const dashboardQuery = z.object({ tz });

export const applicationsAnalyticsQuery = z
  .object({
    from: date.optional(),
    to: date.optional(),
    months: z.coerce.number().int().min(1).max(24).default(6),
    tz,
  })
  .refine(({ from, to }) => !from || !to || from < to, { path: ['to'], message: '`to` must be after `from`' });
