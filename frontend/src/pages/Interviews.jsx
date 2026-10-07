import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import InterviewCard from '../components/interviews/InterviewCard.jsx';
import InterviewForm from '../components/interviews/InterviewForm.jsx';
import { Alert, Button } from '../components/ui.jsx';
import { dayLabel, startOfToday } from '../lib/format.js';
import { api } from '../services/api.js';

const TABS = {
  upcoming: { label: 'Upcoming', query: () => ({ from: startOfToday().toISOString(), status: 'SCHEDULED', order: 'asc' }) },
  history: { label: 'History', query: () => ({ to: new Date().toISOString(), order: 'desc' }) },
};

const CLOSED_STATUSES = new Set(['REJECTED', 'WITHDRAWN', 'ACCEPTED']);

function groupByDay(interviews) {
  const groups = [];
  for (const interview of interviews) {
    const label = dayLabel(interview.scheduledAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(interview);
    else groups.push({ label, items: [interview] });
  }
  return groups;
}

export default function Interviews() {
  const [params, setParams] = useSearchParams();
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'upcoming';
  const [state, setState] = useState({ loading: true, items: [], nextCursor: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [applications, setApplications] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState(null);

  const reload = useCallback(() => setQuery(TABS[tab].query()), [tab]);
  useEffect(reload, [reload]);

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api.interviews
      .list(query, controller.signal)
      .then(({ data, meta }) => setState({ loading: false, items: data, nextCursor: meta.nextCursor, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, loading: false, error: err.message })));
    return () => controller.abort();
  }, [query]);

  const openForm = async () => {
    setShowForm(true);
    if (applications) return;
    try {
      const { data } = await api.applications.list({ limit: 100, sort: 'company' });
      setApplications(data.filter((a) => !CLOSED_STATUSES.has(a.status)));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, meta } = await api.interviews.list({ ...query, cursor: state.nextCursor });
      setState((prev) => ({ ...prev, items: [...prev.items, ...data], nextCursor: meta.nextCursor }));
    } finally {
      setLoadingMore(false);
    }
  };

  const drop = (id) => setState((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Interviews &amp; OAs</h1>
          <p className="mt-1 text-slate-600">Every round on one calendar, with reminders before each.</p>
        </div>
        {!showForm && <Button onClick={openForm}>+ Schedule a round</Button>}
      </header>

      {showForm &&
        (applications === null ? (
          <p className="text-sm text-slate-500">Loading your applications…</p>
        ) : applications.length === 0 ? (
          <Alert>
            Track an application first — rounds belong to an application. <Link to="/jobs" className="font-medium underline">Find opportunities</Link>
          </Alert>
        ) : (
          <InterviewForm
            applications={applications}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              reload();
            }}
          />
        ))}

      <nav className="flex gap-1" aria-label="Interview views">
        {Object.entries(TABS).map(([key, { label }]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setParams(key === 'upcoming' ? {} : { tab: key }, { replace: true })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {state.error && <Alert>{state.error}</Alert>}

      {!state.loading && state.items.length === 0 && !state.error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium text-slate-900">{tab === 'upcoming' ? 'Nothing scheduled' : 'No past rounds yet'}</p>
          <p className="mt-1 text-sm text-slate-600">
            Got an OA link or an interview invite? Schedule it and Jobyssey will remind you before it starts.
          </p>
        </div>
      )}

      <div className={`space-y-6 transition-opacity ${state.loading ? 'opacity-60' : ''}`}>
        {groupByDay(state.items).map((group) => (
          <section key={group.label}>
            <h2 className={`mb-2 text-sm font-semibold ${group.label === 'Today' ? 'text-indigo-700' : 'text-slate-700'}`}>{group.label}</h2>
            <div className="space-y-2">
              {group.items.map((interview) => (
                <InterviewCard
                  key={interview.id}
                  interview={interview}
                  job={interview.application.job}
                  onChanged={reload}
                  onRemoved={drop}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {state.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
