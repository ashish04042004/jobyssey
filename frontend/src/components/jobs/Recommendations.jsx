import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatCtc } from '../../lib/format.js';
import { api } from '../../services/api.js';
import CompanyAvatar from './CompanyAvatar.jsx';
import MatchBadge from './MatchBadge.jsx';

export default function Recommendations() {
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.jobs
      .list({ sort: 'match', limit: 10 }, controller.signal)
      .then(({ data }) => setJobs(data.filter((job) => !job.application).slice(0, 3)))
      .catch((err) => err.name !== 'AbortError' && setJobs([]));
    return () => controller.abort();
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Recommended for you</h2>
        <Link to="/jobs" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          View all →
        </Link>
      </div>

      {jobs === null && <p className="mt-3 text-sm text-slate-500">Finding matches…</p>}
      {jobs?.length === 0 && <p className="mt-3 text-sm text-slate-500">No new opportunities right now. Check back soon.</p>}

      <ul className="mt-3 divide-y divide-slate-100">
        {jobs?.map((job) => (
          <li key={job.id}>
            <Link to={`/jobs/${job.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50">
              <CompanyAvatar company={job.company} size="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {job.company.name} — {job.title}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[...job.locations, ...(job.isRemote ? ['Remote'] : [])].join(' · ')} · {formatCtc(job.ctcMinLpa, job.ctcMaxLpa)}
                </p>
              </div>
              <MatchBadge score={job.matchScore} breakdown={job.matchBreakdown} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
