// Deterministic job ↔ profile scoring. Pure functions only; see docs/api.md §5.

export const ROLE_CATEGORIES = Object.freeze([
  'SDE',
  'Backend',
  'Frontend',
  'Full Stack',
  'Data',
  'ML',
  'DevOps',
  'Android',
  'iOS',
  'Product',
  'Other',
]);

export const WEIGHTS = Object.freeze({ role: 30, location: 25, graduation: 25, salary: 20 });

const ROLE_SYNONYMS = {
  sde: ['sde', 'swe', 'software engineer', 'software developer', 'software development engineer', 'mts', 'member of technical staff', 'developer'],
  backend: ['backend', 'back end', 'back-end', 'server side'],
  frontend: ['frontend', 'front end', 'front-end', 'ui engineer', 'web developer'],
  'full stack': ['full stack', 'fullstack', 'full-stack'],
  data: ['data analyst', 'data engineer', 'data scientist', 'analytics', 'data'],
  ml: ['machine learning', 'ml', 'ai engineer', 'deep learning', 'applied scientist'],
  devops: ['devops', 'sre', 'site reliability', 'infrastructure', 'platform engineer', 'cloud engineer'],
  android: ['android', 'mobile'],
  ios: ['ios', 'mobile'],
  product: ['product manager', 'apm', 'associate product manager', 'product'],
};

const LOCATION_SYNONYMS = {
  'delhi ncr': ['delhi', 'new delhi', 'ncr', 'noida', 'greater noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad'],
  bengaluru: ['bengaluru', 'bangalore'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane'],
  hyderabad: ['hyderabad', 'secunderabad'],
  chennai: ['chennai', 'madras'],
  pune: ['pune'],
  kolkata: ['kolkata', 'calcutta'],
  remote: ['remote', 'work from home', 'wfh', 'anywhere'],
};

const normalise = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function expand(term, synonyms) {
  const key = normalise(term);
  const direct = synonyms[key];
  if (direct) return new Set([key, ...direct]);
  // A user who types "Noida" should also match jobs listed under "Delhi NCR".
  for (const [canonical, aliases] of Object.entries(synonyms)) {
    if (aliases.includes(key)) return new Set([canonical, ...aliases]);
  }
  return new Set([key]);
}

// Word-boundary containment so "ml" doesn't match "html".
function containsPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

export function matchesRole(job, preferredRole) {
  const haystack = `${normalise(job.roleCategory)} | ${normalise(job.title)}`;
  return [...expand(preferredRole, ROLE_SYNONYMS)].some((phrase) => containsPhrase(haystack, phrase));
}

export function matchesLocation(job, preferredLocation) {
  const wanted = expand(preferredLocation, LOCATION_SYNONYMS);
  if (job.isRemote && wanted.has('remote')) return true;
  return job.locations.some((location) => {
    const text = normalise(location);
    return [...wanted].some((phrase) => containsPhrase(text, phrase));
  });
}

function ctcCeiling(job) {
  return job.ctcMaxLpa ?? job.ctcMinLpa ?? null;
}

/**
 * @param job     { title, roleCategory, locations[], isRemote, graduationYears[], ctcMinLpa, ctcMaxLpa }
 * @param profile { preferredRoles[], preferredLocations[], graduationYear, minCtcLpa }
 * @returns {{ score: number, breakdown: { role, location, graduation, salary } }}
 */
export function scoreJob(job, profile) {
  const roles = profile.preferredRoles ?? [];
  const locations = profile.preferredLocations ?? [];

  const role = roles.length === 0
    ? WEIGHTS.role / 2
    : roles.some((r) => matchesRole(job, r)) ? WEIGHTS.role : 0;

  const location = locations.length === 0
    ? Math.floor(WEIGHTS.location / 2)
    : locations.some((l) => matchesLocation(job, l)) ? WEIGHTS.location : 0;

  const years = job.graduationYears ?? [];
  const graduation = years.length === 0 || years.includes(profile.graduationYear) ? WEIGHTS.graduation : 0;

  const ceiling = ctcCeiling(job);
  const salary = profile.minCtcLpa == null || ceiling == null
    ? WEIGHTS.salary / 2
    : ceiling >= profile.minCtcLpa ? WEIGHTS.salary : 0;

  const breakdown = { role, location, graduation, salary };
  return { score: role + location + graduation + salary, breakdown };
}
