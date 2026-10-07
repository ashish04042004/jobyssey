import { useCallback, useEffect, useState } from 'react';
import { Alert, Button } from '../components/ui.jsx';
import { timeAgo } from '../lib/format.js';
import { api } from '../services/api.js';

const REFRESH_MS = 15_000;
const QUEUE_COLUMNS = ['waiting', 'active', 'delayed', 'failed', 'completed'];

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Health({ ok, label, detail }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="mt-0.5 text-sm text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

const percent = (value) => (value === null ? '—' : `${Math.round(value * 100)}%`);

function formatLag(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function FailedJobs({ queues, onRetried }) {
  const [queue, setQueue] = useState(queues[0]?.name);
  const [state, setState] = useState({ loading: true, jobs: [], error: null });
  const [retrying, setRetrying] = useState(null);

  const load = useCallback(
    (signal) => {
      if (!queue) return;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      api.admin
        .failedJobs(queue, signal)
        .then(({ data }) => setState({ loading: false, jobs: data, error: null }))
        .catch((err) => err.name !== 'AbortError' && setState({ loading: false, jobs: [], error: err.message }));
    },
    [queue],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const retry = async (job) => {
    setRetrying(job.id);
    try {
      await api.admin.retryJob(queue, job.id);
      setState((prev) => ({ ...prev, jobs: prev.jobs.filter((j) => j.id !== job.id) }));
      onRetried();
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Failed jobs</h2>
        <nav className="flex gap-1" aria-label="Queue">
          {queues.map(({ name, counts }) => (
            <button
              key={name}
              type="button"
              aria-pressed={queue === name}
              onClick={() => setQueue(name)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${queue === name ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}
            >
              {name}
              {counts.failed > 0 && <span className="ml-1.5 text-rose-500">{counts.failed}</span>}
            </button>
          ))}
        </nav>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {!state.loading && state.jobs.length === 0 && !state.error && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-600">
          No failed jobs in this queue.
        </p>
      )}
      {state.jobs.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {state.jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {job.name} <span className="font-mono text-xs text-slate-400">{job.id}</span>
                </p>
                <p className="mt-0.5 break-words text-sm text-rose-600">{job.failedReason ?? 'Unknown error'}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {job.attemptsMade}/{job.maxAttempts} attempts{job.failedAt && ` · failed ${timeAgo(job.failedAt)}`}
                </p>
              </div>
              <Button variant="secondary" loading={retrying === job.id} onClick={() => retry(job)}>
                Retry
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Admin() {
  const [state, setState] = useState({ loading: true, metrics: null, error: null });

  const load = useCallback((signal) => {
    api.admin
      .metrics(signal)
      .then(({ data }) => setState({ loading: false, metrics: data, error: null }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        const error = err.status === 403 ? 'Only admins can view system status.' : err.message;
        setState((prev) => ({ ...prev, loading: false, error }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [load]);

  const m = state.metrics;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System</h1>
          <p className="mt-1 text-slate-600">
            Usage over the last 7 days and the health of background processing.
            {m && <span className="text-slate-400"> Updated {timeAgo(m.generatedAt)}.</span>}
          </p>
        </div>
        <Button variant="secondary" onClick={() => load()}>
          Refresh
        </Button>
      </header>

      {state.error && <Alert>{state.error}</Alert>}
      {state.loading && !m && <p className="text-sm text-slate-500">Loading…</p>}

      {m && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Users" value={m.users.total} hint={`${m.users.activeLast7Days} active · ${m.users.newLast7Days} new this week`} />
            <Stat
              label="Applications"
              value={m.applications.total}
              hint={`${m.applications.createdLast7Days} created · ${m.applications.updatedLast7Days} updated this week`}
            />
            <Stat
              label="Reminders delivered"
              value={m.reminders.sentLast7Days}
              hint={`${percent(m.reminders.deliveryRate)} delivery rate · ${m.reminders.failedLast7Days} failed`}
            />
            <Stat label="Notifications" value={m.notifications.createdLast7Days} hint="created this week" />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Health
              ok={m.worker.status === 'ok'}
              label={m.worker.status === 'ok' ? 'Worker running' : 'Worker not reporting'}
              detail={m.worker.lastHeartbeatAt ? `Last heartbeat ${timeAgo(m.worker.lastHeartbeatAt)}` : 'No heartbeat in the last 45 seconds'}
            />
            <Health
              ok={m.outbox.lagSeconds < 60}
              label={m.outbox.pending ? `${m.outbox.pending} events waiting to publish` : 'Outbox drained'}
              detail={
                m.outbox.pending
                  ? `Oldest is ${formatLag(m.outbox.lagSeconds)} old${m.outbox.retrying ? ` · ${m.outbox.retrying} retrying` : ''}`
                  : 'Every domain event has been handed to the queues'
              }
            />
          </section>

          {m.queues && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Queues</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Queue</th>
                      {QUEUE_COLUMNS.map((col) => (
                        <th key={col} className="px-4 py-2.5 text-right">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {m.queues.map(({ name, counts }) => (
                      <tr key={name}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{name}</td>
                        {QUEUE_COLUMNS.map((col) => (
                          <td
                            key={col}
                            className={`px-4 py-2.5 text-right tabular-nums ${col === 'failed' && counts[col] ? 'font-semibold text-rose-600' : 'text-slate-700'}`}
                          >
                            {counts[col] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {m.queues?.length > 0 && <FailedJobs queues={m.queues} onRetried={() => load()} />}
        </>
      )}
    </div>
  );
}
