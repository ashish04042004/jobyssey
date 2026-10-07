import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import CompanyAvatar from '../components/jobs/CompanyAvatar.jsx';
import { DeadlineChip } from '../components/jobs/JobCard.jsx';
import MatchBadge, { MatchBreakdown } from '../components/jobs/MatchBadge.jsx';
import SaveJobButton from '../components/jobs/SaveJobButton.jsx';
import FullPageLoader from '../components/FullPageLoader.jsx';
import { Alert, Button } from '../components/ui.jsx';
import { EMPLOYMENT_TYPES, formatCtc } from '../lib/format.js';
import { api } from '../services/api.js';

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setJob(null);
    setError(null);
    api.jobs
      .get(id, controller.signal)
      .then(({ data }) => setJob(data))
      .catch((err) => err.name !== 'AbortError' && setError(err.status === 404 ? 'This job does not exist or was removed.' : err.message));
    return () => controller.abort();
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Link to="/jobs" className="text-sm font-medium text-indigo-600">← Back to opportunities</Link>
      </div>
    );
  }
  if (!job) return <FullPageLoader />;

  const archive = async () => {
    if (!window.confirm('Remove this job? It will disappear from listings. Saved applications are kept.')) return;
    setArchiving(true);
    try {
      await api.jobs.archive(job.id);
      navigate('/jobs', { replace: true });
    } catch (err) {
      setError(err.message);
      setArchiving(false);
    }
  };

  const where = [...job.locations, ...(job.isRemote ? ['Remote'] : [])].join(', ') || 'Not specified';

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="text-sm font-medium text-slate-600 hover:text-slate-900">← Opportunities</Link>

      <header className="flex flex-wrap items-start gap-4 rounded-xl border border-slate-200 bg-white p-6">
        <CompanyAvatar company={job.company} size="size-14" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
            <MatchBadge score={job.matchScore} breakdown={job.matchBreakdown} />
          </div>
          <p className="mt-0.5 text-slate-600">{job.company.name}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DeadlineChip iso={job.applicationDeadline} />
            {!job.isActive && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Removed from listings</span>}
            {job.visibility === 'PRIVATE' && (
              <span className="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Only visible to you</span>
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {job.jobUrl && (
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Apply on company site ↗
            </a>
          )}
          {job.isActive && <SaveJobButton job={job} size="md" onSaved={(application) => setJob({ ...job, application })} />}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <dl className="grid gap-5 sm:grid-cols-2">
              <Fact label="Location">{where}</Fact>
              <Fact label="CTC">{formatCtc(job.ctcMinLpa, job.ctcMaxLpa)}</Fact>
              <Fact label="Type">{EMPLOYMENT_TYPES[job.employmentType]}</Fact>
              <Fact label="Batch">{job.graduationYears.length ? job.graduationYears.join(', ') : 'Open to all'}</Fact>
              {job.applicationDeadline && (
                <Fact label="Deadline">{new Date(job.applicationDeadline).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Fact>
              )}
              {job.roleCategory && <Fact label="Role">{job.roleCategory}</Fact>}
            </dl>
            {job.eligibility && (
              <div className="mt-6">
                <h2 className="text-sm font-semibold text-slate-900">Eligibility</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{job.eligibility}</p>
              </div>
            )}
          </section>

          {job.description && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-slate-900">About the role</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{job.description}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-900">Why {job.matchScore}%?</h2>
            <div className="mt-4">
              <MatchBreakdown breakdown={job.matchBreakdown} />
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Based on your <Link to="/profile" className="font-medium text-indigo-600">profile preferences</Link>.
            </p>
          </section>

          {job.canEdit && (
            <section className="flex gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <Link to={`/jobs/${job.id}/edit`} className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50">
                Edit
              </Link>
              {job.isActive && (
                <Button variant="ghost" loading={archiving} onClick={archive} className="flex-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                  Remove
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
