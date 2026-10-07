import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import JobCard from '../components/jobs/JobCard.jsx';
import { Alert, Button, Input, Select } from '../components/ui.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { EMPLOYMENT_TYPES, ROLE_CATEGORIES } from '../lib/format.js';
import { api } from '../services/api.js';

const SORTS = { match: 'Best match', deadline: 'Closing soon', recent: 'Newest' };
const FILTER_KEYS = ['q', 'location', 'roleCategory', 'employmentType', 'sort', 'mine'];

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? '']));
  const [search, setSearch] = useState(filters.q);
  const [location, setLocation] = useState(filters.location);
  const debouncedSearch = useDebouncedValue(search);
  const debouncedLocation = useDebouncedValue(location);

  const [state, setState] = useState({ loading: true, jobs: [], total: 0, nextCursor: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);

  const setFilter = useCallback(
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

  useEffect(() => setFilter('q', debouncedSearch.trim()), [debouncedSearch, setFilter]);
  useEffect(() => setFilter('location', debouncedLocation.trim()), [debouncedLocation, setFilter]);

  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api.jobs
      .list(Object.fromEntries(new URLSearchParams(query)), controller.signal)
      .then(({ data, meta }) => setState({ loading: false, jobs: data, total: meta.total, nextCursor: meta.nextCursor, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState((prev) => ({ ...prev, loading: false, error: err.message }));
      });
    return () => controller.abort();
  }, [query]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, meta } = await api.jobs.list({ ...Object.fromEntries(params), cursor: state.nextCursor });
      setState((prev) => ({ ...prev, jobs: [...prev.jobs, ...data], nextCursor: meta.nextCursor }));
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setLoadingMore(false);
    }
  };

  const markSaved = (jobId, application) =>
    setState((prev) => ({ ...prev, jobs: prev.jobs.map((job) => (job.id === jobId ? { ...job, application } : job)) }));

  const hasFilters = FILTER_KEYS.some((key) => key !== 'sort' && filters[key]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Opportunities</h1>
          <p className="mt-1 text-slate-600">Ranked by how well each opening fits your profile.</p>
        </div>
        <Link to="/jobs/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          + Add a job
        </Link>
      </header>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          type="search"
          placeholder="Search company or role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="lg:col-span-2"
          aria-label="Search"
        />
        <Input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location" />
        <Select value={filters.roleCategory} onChange={(e) => setFilter('roleCategory', e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLE_CATEGORIES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </Select>
        <Select value={filters.employmentType} onChange={(e) => setFilter('employmentType', e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-slate-600">
          {state.loading ? 'Loading…' : `${state.total} opening${state.total === 1 ? '' : 's'}`}
          {hasFilters && !state.loading && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setLocation('');
                setParams(filters.sort ? { sort: filters.sort } : {}, { replace: true });
              }}
              className="ml-3 font-medium text-indigo-600 hover:text-indigo-500"
            >
              Clear filters
            </button>
          )}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 whitespace-nowrap text-slate-600">
            <input
              type="checkbox"
              checked={filters.mine === 'true'}
              onChange={(e) => setFilter('mine', e.target.checked ? 'true' : '')}
              className="rounded border-slate-300 text-indigo-600"
            />
            Added by me
          </label>
          <Select value={filters.sort || 'match'} onChange={(e) => setFilter('sort', e.target.value === 'match' ? '' : e.target.value)} className="w-auto" aria-label="Sort">
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {state.error && <Alert>{state.error}</Alert>}

      {!state.loading && state.jobs.length === 0 && !state.error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium text-slate-900">No openings match these filters</p>
          <p className="mt-1 text-sm text-slate-600">
            Found one elsewhere? <Link to="/jobs/new" className="font-medium text-indigo-600">Add it</Link> to track it here.
          </p>
        </div>
      )}

      <ul className={`space-y-3 transition-opacity ${state.loading ? 'opacity-60' : ''}`}>
        {state.jobs.map((job) => (
          <JobCard key={job.id} job={job} onSaved={(application) => markSaved(job.id, application)} />
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
