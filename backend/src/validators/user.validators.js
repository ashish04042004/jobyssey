import { z } from 'zod';
import { graduationYear } from './auth.validators.js';

const tagList = (label, maxItems) =>
  z
    .array(z.string().trim().min(1).max(50, `${label} entries must be at most 50 characters`))
    .max(maxItems, `At most ${maxItems} ${label.toLowerCase()}`)
    .transform((items) => [...new Map(items.map((item) => [item.toLowerCase(), item])).values()]);

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    college: z.string().trim().min(1).max(120),
    degree: z.string().trim().max(80).nullable(),
    branch: z.string().trim().min(1).max(80),
    graduationYear,
    preferredRoles: tagList('Preferred roles', 10),
    preferredLocations: tagList('Preferred locations', 10),
    minCtcLpa: z.number().min(0).max(999).nullable(),
    skills: tagList('Skills', 30),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
