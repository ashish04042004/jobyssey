import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import NotesEditor from '../components/applications/NotesEditor.jsx';
import PrepChecklist from '../components/applications/PrepChecklist.jsx';
import ResumePicker from '../components/applications/ResumePicker.jsx';
import StatusBadge from '../components/applications/StatusBadge.jsx';
import StatusChanger from '../components/applications/StatusChanger.jsx';
import Timeline from '../components/applications/Timeline.jsx';
import FullPageLoader from '../components/FullPageLoader.jsx';
import CompanyAvatar from '../components/jobs/CompanyAvatar.jsx';
import { DeadlineChip } from '../components/jobs/JobCard.jsx';
import { Alert, Button } from '../components/ui.jsx';
import InterviewCard from '../components/interviews/InterviewCard.jsx';
import InterviewForm from '../components/interviews/InterviewForm.jsx';
import { dayLabel, formatDate, STATUS_LABELS } from '../lib/format.js';
import { api } from '../services/api.js';

function Card({ title, aside, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [application, setApplication] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  const load = useCallback(
    (signal) =>
      api.applications
        .get(id, signal)
        .then(({ data }) => setApplication(data))
        .catch((err) => err.name !== 'AbortError' && setError(err.status === 404 ? 'This application does not exist or was removed.' : err.message)),
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setApplication(null);
    setError(null);
    setNotice(null);
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Link to="/applications" className="text-sm font-medium text-indigo-600">← Back to applications</Link>
      </div>
    );
  }
  if (!application) return <FullPageLoader />;

  const { job } = application;
  const done = application.prepItems.filter((item) => item.isDone).length;

  const remove = async () => {
    if (!window.confirm(`Stop tracking ${job.company.name}? Its timeline, notes and prep list will be removed.`)) return;
    setRemoving(true);
    try {
      await api.applications.remove(application.id);
      navigate('/applications', { replace: true });
    } catch (err) {
      setNotice({ tone: 'error', text: err.message });
      setRemoving(false);
    }
  };

  const applySuggestion = async (status) => {
    setSuggestion(null);
    try {
      const { data } = await api.applications.changeStatus(application.id, { status, expectedVersion: application.version });
      setApplication(data);
    } catch (err) {
      setNotice({ tone: 'error', text: err.message });
      await load();
    }
  };

  const onConflict = async () => {
    setNotice({ tone: 'error', text: 'This application was updated somewhere else (another tab?). Showing the latest version — try again.' });
    await load();
  };

  return (
    <div className="space-y-6">
      <Link to="/applications" className="text-sm font-medium text-slate-600 hover:text-slate-900">← Applications</Link>

      <header className="flex flex-wrap items-start gap-4 rounded-xl border border-slate-200 bg-white p-6">
        <CompanyAvatar company={job.company} size="size-14" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
            <StatusBadge status={application.status} />
          </div>
          <p className="mt-0.5 text-slate-600">{job.company.name}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            {application.appliedAt ? <span>Applied {formatDate(application.appliedAt)}</span> : <DeadlineChip iso={job.applicationDeadline} />}
            <span>Tracking since {formatDate(application.createdAt)}</span>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link to={`/jobs/${job.id}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Job details
          </Link>
          {job.jobUrl && (
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Company site ↗
            </a>
          )}
        </div>
      </header>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Update status">
            <StatusChanger
              application={application}
              onChanged={(data) => {
                setNotice(null);
                setApplication(data);
              }}
              onConflict={onConflict}
            />
          </Card>

          <Card
            title="Interviews & OAs"
            aside={
              !scheduling && (
                <Button variant="secondary" onClick={() => setScheduling(true)} className="px-3 py-1.5">
                  + Schedule round
                </Button>
              )
            }
          >
            <div className="space-y-3">
              {suggestion && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
                  <p className="text-sm text-indigo-900">
                    Move this application to <span className="font-semibold">{STATUS_LABELS[suggestion]}</span> as well?
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => applySuggestion(suggestion)} className="px-3 py-1.5">
                      Move to {STATUS_LABELS[suggestion]}
                    </Button>
                    <Button variant="ghost" onClick={() => setSuggestion(null)} className="px-3 py-1.5">
                      Not now
                    </Button>
                  </div>
                </div>
              )}
              {scheduling && (
                <InterviewForm
                  applicationId={application.id}
                  onCancel={() => setScheduling(false)}
                  onSaved={async (interview) => {
                    setScheduling(false);
                    const next = interview.type === 'OA' ? 'OA' : 'INTERVIEW';
                    if (application.allowedTransitions.includes(next)) setSuggestion(next);
                    await load();
                  }}
                />
              )}
              {application.interviews.length === 0 && !scheduling && (
                <p className="text-sm text-slate-500">No rounds yet. Add OA links and interview slots to get reminders before each one.</p>
              )}
              {application.interviews.map((interview) => (
                <div key={interview.id}>
                  <p className="mb-1 text-xs font-medium text-slate-500">{dayLabel(interview.scheduledAt)}</p>
                  <InterviewCard interview={{ ...interview, applicationId: application.id }} onChanged={() => load()} onRemoved={() => load()} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Timeline">
            <Timeline events={application.timeline} />
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="Resume used">
            <ResumePicker application={application} onSaved={(data) => setApplication(data)} />
          </Card>

          <Card title="Notes">
            <NotesEditor key={application.id} application={application} onSaved={(data) => setApplication(data)} />
          </Card>

          <Card title="Prep checklist" aside={application.prepItems.length > 0 && <span className="text-xs text-slate-500">{done}/{application.prepItems.length} done</span>}>
            <PrepChecklist
              applicationId={application.id}
              items={application.prepItems}
              onChange={(prepItems) => setApplication((prev) => ({ ...prev, prepItems }))}
            />
          </Card>

          <Button variant="ghost" loading={removing} onClick={remove} className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700">
            Stop tracking
          </Button>
        </aside>
      </div>
    </div>
  );
}
