export const FUNNEL_STAGES = Object.freeze(['applied', 'oa', 'interview', 'offer']);

const STAGE_OF_STATUS = Object.freeze({
  APPLIED: 'applied',
  OA: 'oa',
  OA_COMPLETED: 'oa',
  INTERVIEW: 'interview',
  OFFER: 'offer',
  ACCEPTED: 'offer',
});

const ACTIVE = new Set(['APPLIED', 'OA', 'OA_COMPLETED', 'INTERVIEW', 'OFFER']);

const rate = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);

/**
 * Stages an application actually passed through, from the statuses it was
 * moved into. A skipped stage (APPLIED → INTERVIEW without an OA) is not
 * counted, so conversion rates stay honest.
 */
export function stagesReached({ statuses, appliedAt }) {
  const stages = new Set(statuses.map((s) => STAGE_OF_STATUS[s]).filter(Boolean));
  if (appliedAt || stages.size > 0) stages.add('applied');
  return stages;
}

/**
 * Funnel, conversion, outcomes and per-company breakdown for a list of
 * applications shaped `{ company, status, statuses[], appliedAt }`.
 * Saved-but-never-applied applications are ignored.
 */
export function summarizeFunnel(applications, { topCompanies = 10 } = {}) {
  const funnel = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, 0]));
  const outcomes = { active: 0, offers: 0, accepted: 0, rejected: 0, withdrawn: 0 };
  const companies = new Map();
  let responded = 0;

  for (const app of applications) {
    const stages = stagesReached(app);
    if (!stages.has('applied')) continue;

    for (const stage of stages) funnel[stage] += 1;
    if (stages.has('oa') || stages.has('interview') || stages.has('offer') || app.statuses.includes('REJECTED')) responded += 1;

    if (app.status === 'ACCEPTED') outcomes.accepted += 1;
    else if (app.status === 'REJECTED') outcomes.rejected += 1;
    else if (app.status === 'WITHDRAWN') outcomes.withdrawn += 1;
    else if (ACTIVE.has(app.status)) outcomes.active += 1;
    if (stages.has('offer')) outcomes.offers += 1;

    const row = companies.get(app.company) ?? { company: app.company, applied: 0, oa: 0, interview: 0, offer: 0 };
    for (const stage of stages) row[stage] += 1;
    companies.set(app.company, row);
  }

  return {
    funnel,
    conversion: {
      appliedToOa: rate(funnel.oa, funnel.applied),
      appliedToInterview: rate(funnel.interview, funnel.applied),
      interviewToOffer: rate(funnel.offer, funnel.interview),
    },
    responseRate: rate(responded, funnel.applied),
    outcomes,
    byCompany: [...companies.values()]
      .sort((a, b) => b.applied - a.applied || b.offer - a.offer || b.interview - a.interview || a.company.localeCompare(b.company))
      .slice(0, topCompanies),
  };
}
