import { z } from 'zod';

const currentYear = new Date().getUTCFullYear();

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254, 'Email must be at most 254 characters'));

export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

const shortText = (label, max = 120) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

export const graduationYear = z.coerce
  .number()
  .int()
  .min(currentYear - 10, 'Graduation year looks too far in the past')
  .max(currentYear + 6, 'Graduation year looks too far in the future');

export const registerSchema = z.object({
  name: shortText('Name', 80),
  email,
  password,
  college: shortText('College'),
  branch: shortText('Branch', 80),
  graduationYear,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});
