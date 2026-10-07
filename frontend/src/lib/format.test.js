import { describe, expect, it } from 'vitest';
import { dayLabel, describeDeadline, describeWhen, formatBytes, formatCtc, formatOffset, fromLocalInput, timeAgo, toLocalInput } from './format.js';

const NOW = new Date('2026-10-07T12:00:00').getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('describeDeadline', () => {
  it('marks closed, urgent and comfortable deadlines', () => {
    expect(describeDeadline(new Date(NOW - HOUR).toISOString(), NOW)).toMatchObject({ label: 'Closed', closed: true });
    expect(describeDeadline(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toEqual({ label: 'Closes in 5h', urgent: true, closed: false });
    expect(describeDeadline(new Date(NOW + 2 * DAY + HOUR).toISOString(), NOW)).toEqual({ label: 'Closes in 2 days', urgent: true, closed: false });
    expect(describeDeadline(new Date(NOW + DAY + HOUR).toISOString(), NOW).label).toBe('Closes in 1 day');
    expect(describeDeadline(new Date(NOW + 10 * DAY).toISOString(), NOW)).toMatchObject({ urgent: false, closed: false });
    expect(describeDeadline(null)).toBeNull();
  });
});

describe('describeWhen', () => {
  it('uses relative wording for the next few hours', () => {
    expect(describeWhen(new Date(NOW + 20 * 60_000).toISOString(), NOW)).toBe('in 20 min');
    expect(describeWhen(new Date(NOW + 30_000).toISOString(), NOW)).toBe('in 1 min');
    expect(describeWhen(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toBe('in 5 hours');
    expect(describeWhen(new Date(NOW + DAY).toISOString(), NOW)).toMatch(/^Tomorrow, /);
  });
});

describe('dayLabel', () => {
  it('names nearby days', () => {
    const now = new Date(NOW);
    expect(dayLabel(new Date(NOW + 2 * HOUR).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(NOW - DAY).toISOString(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(NOW + DAY).toISOString(), now)).toBe('Tomorrow');
  });
});

describe('small formatters', () => {
  it('formats sizes, offsets, CTC and ages', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(34_000)).toBe('33 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatOffset(1440)).toBe('1 day');
    expect(formatOffset(2880)).toBe('2 days');
    expect(formatOffset(120)).toBe('2 hours');
    expect(formatOffset(45)).toBe('45 min');
    expect(formatCtc(null, null)).toBe('CTC not disclosed');
    expect(formatCtc(18, 24)).toBe('₹18–24 LPA');
    expect(formatCtc(null, 30)).toBe('₹30 LPA');
    expect(timeAgo(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
    expect(timeAgo(new Date(NOW - 3 * HOUR).toISOString(), NOW)).toBe('3h ago');
    expect(timeAgo(new Date(NOW - 4 * DAY).toISOString(), NOW)).toBe('4d ago');
  });

  it('round-trips datetime-local values in the local zone', () => {
    const iso = '2026-10-09T05:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
  });
});
