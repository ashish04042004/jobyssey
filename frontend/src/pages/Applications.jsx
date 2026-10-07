import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import StatusBadge from '../components/applications/StatusBadge.jsx';
import CompanyAvatar from '../components/jobs/CompanyAvatar.jsx';
import { DeadlineChip } from '../components/jobs/JobCard.jsx';
import { Alert, Button, Input, Select } from '../components/ui.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { formatDate, STATUS_LABELS, timeAgo } from '../lib/format.js';
import { api } from '../services/api.js';

const SORTS = { updated: 'Recently updated', deadline: 'Deadline', company: 'Company A–Z' };

function ApplicationRow({ application }) {
  const { job } = application;
  const detail =
    application.status === 'SAVED'
      ? null
      : application.appliedAt && `Applied ${formatDate(application.appliedAt)}`;

  return (
    <li className="relative flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm">
      <CompanyAvatar company={job.company} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-slate-900">
          <Link to={`/applications/${application.id}`} className="after:absolute after:inset-0 focus:outline-none">
            {job.title}
          </Link>
        </h3>
        <p className="truncate text-sm text-slate-600">
          {job.company.name}
          {detail && <span className="text-slate-400"> · {detail}</span>}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <StatusBadge status={application.status} />
        {application.status === 'SAVED' && job.applicationDeadline ? (
          <DeadlineChip iso={job.applicationDeadline} />
        ) : (
          <span className="text-xs text-slate-500">Updated {timeAgo(application.statusChangedAt)}</span>
        )}
      </div>
    </li>
  );
}

export default function Applications() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'updated';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search);

  const [state, setState] = useState({ loading: true, items: [], counts: null, total: 0, nextCursor: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);

  const setParam = useCallback(
    (key, value) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  useEffect(() => setParam('q', debouncedSearch.trim()), [debouncedSearch, setParam]);

  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api.applications
      .list(Object.fromEntries(new URLSearchParams(query)), controller.signal)
      .then(({ data, meta }) =>
        setState({ loading: false, items: data, counts: meta.counts, total: meta.total, nextCursor: meta.nextCursor, error: null }),
      )
      .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, loading: false, error: err.message })));
    return () => controller.abort();
  }, [query]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, meta } = await api.applications.list({ ...Object.fromEntries(params), cursor: state.nextCursor });
      setState((prev) => ({ ...prev, items: [...prev.items, ...data], nextCursor: meta.nextCursor }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setLoadingMore(false);
    }
  };

  const counts = state.counts ?? {};
  const allCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tabs = [['', 'All', allCount], ...Object.entries(STATUS_LABELS).map(([key, label]) => [key, label, counts[key] ?? 0])];
  const nothingTracked = !state.loading && allCount === 0 && !params.get('q');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="mt-1 text-slate-600">Every company you're tracking, from saved to offer.</p>
        </div>
        <Link to="/jobs" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Find opportunities
        </Link>
      </header>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Filter by status">
        {tabs.map(([key, label, count]) => {
          const active = status === key;
          return (
            <button
              key={key || 'all'}
              type="button"
              onClick={() => setParam('status', key)}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {label}
              <span className={`rounded px-1.5 text-xs ${active ? 'bg-white/20' : 'bg-slate-200/70 text-slate-600'}`}>{count}</span>
            </button>
          );
        })}
      </nav>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input
          type="search"
          placeholder="Search company or role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search applications"
        />
        <Select value={sort} onChange={(e) => setParam('sort', e.target.value === 'updated' ? '' : e.target.value)} aria-label="Sort">
          {Object.entries(SORTS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {state.error && <Alert>{state.error}</Alert>}

      {nothingTracked && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium text-slate-900">You're not tracking anything yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Save openings from <Link to="/jobs" className="font-medium text-indigo-600">Opportunities</Link> and they'll show up here.
          </p>
        </div>
      )}

      {!nothingTracked && !state.loading && state.items.length === 0 && !state.error && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-600">
          No applications match.
        </p>
      )}

      <ul className={`space-y-3 transition-opacity ${state.loading ? 'opacity-60' : ''}`}>
        {state.items.map((application) => (
          <ApplicationRow key={application.id} application={application} />
        ))}
      </ul>

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
