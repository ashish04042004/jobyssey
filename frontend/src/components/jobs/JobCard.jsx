import { Link } from 'react-router';
import { describeDeadline, EMPLOYMENT_TYPES, formatCtc } from '../../lib/format.js';
import CompanyAvatar from './CompanyAvatar.jsx';
import MatchBadge from './MatchBadge.jsx';
import SaveJobButton from './SaveJobButton.jsx';

export function DeadlineChip({ iso }) {
  const deadline = describeDeadline(iso);
  if (!deadline) return null;
  const tone = deadline.closed
    ? 'bg-slate-100 text-slate-500'
    : deadline.urgent
      ? 'bg-rose-50 text-rose-700'
      : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>{deadline.label}</span>;
}

export default function JobCard({ job, onSaved }) {
  const where = [...job.locations, ...(job.isRemote ? ['Remote'] : [])].join(' · ') || 'Location not specified';

  return (
    <li className="relative rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm sm:p-5">
      <div className="flex gap-4">
        <CompanyAvatar company={job.company} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-slate-900">
                <Link to={`/jobs/${job.id}`} className="after:absolute after:inset-0 focus:outline-none">
                  {job.title}
                </Link>
              </h3>
              <p className="text-sm text-slate-600">{job.company.name}</p>
            </div>
            <MatchBadge score={job.matchScore} breakdown={job.matchBreakdown} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            <span>{where}</span>
            <span>{formatCtc(job.ctcMinLpa, job.ctcMaxLpa)}</span>
            {job.employmentType !== 'FULL_TIME' && <span>{EMPLOYMENT_TYPES[job.employmentType]}</span>}
            {job.visibility === 'PRIVATE' && (
              <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Added by you</span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <DeadlineChip iso={job.applicationDeadline} />
            <div className="relative z-10 ml-auto">
              <SaveJobButton job={job} onSaved={onSaved} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
