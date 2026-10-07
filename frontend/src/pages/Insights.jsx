import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '../components/ui.jsx';
import { api } from '../services/api.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = [
  { id: 'all', label: 'All time', from: () => undefined },
  { id: '30d', label: 'Last 30 days', from: () => new Date(Date.now() - 30 * DAY_MS) },
  { id: '90d', label: 'Last 90 days', from: () => new Date(Date.now() - 90 * DAY_MS) },
  { id: 'year', label: 'This year', from: () => new Date(new Date().getFullYear(), 0, 1) },
];

const STAGES = [
  { key: 'applied', label: 'Applied', bar: 'bg-indigo-600' },
  { key: 'oa', label: 'Online assessment', bar: 'bg-indigo-500' },
  { key: 'interview', label: 'Interview', bar: 'bg-violet-500' },
  { key: 'offer', label: 'Offer', bar: 'bg-emerald-500' },
];

const SERIES = [
  { key: 'applications', label: 'Applications', color: 'bg-indigo-500' },
  { key: 'interviews', label: 'Rounds', color: 'bg-violet-400' },
  { key: 'offers', label: 'Offers', color: 'bg-emerald-500' },
];

const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Funnel({ funnel }) {
  const top = funnel.applied || 1;
  return (
    <div className="space-y-3">
      {STAGES.map(({ key, label, bar }) => (
        <div key={key}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-slate-700">{label}</span>
            <span className="tabular-nums text-slate-900">
              <span className="font-semibold">{funnel[key]}</span>
              {key !== 'applied' && <span className="ml-1.5 text-xs text-slate-500">{percent(funnel[key] / top)}</span>}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${(funnel[key] / top) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlyChart({ monthly }) {
  const max = Math.max(1, ...monthly.flatMap((m) => SERIES.map((s) => m[s.key])));
  const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
  return (
    <div>
      <div className="flex h-40 items-end gap-3" role="img" aria-label="Monthly activity chart">
        {monthly.map((m) => (
          <div key={m.month} className="flex h-full flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-1">
              {SERIES.map((s) => (
                <div
                  key={s.key}
                  className={`w-full max-w-4 rounded-t ${s.color}`}
                  style={{ height: `${(m[s.key] / max) * 100}%`, minHeight: m[s.key] ? 4 : 0 }}
                  title={`${s.label}: ${m[s.key]}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 border-t border-slate-100 pt-2">
        {monthly.map((m) => (
          <span key={m.month} className="flex-1 text-center text-xs text-slate-500">
            {monthLabel(m.month)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${s.color}`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Outcomes({ outcomes }) {
  const items = [
    ['In progress', outcomes.active, 'bg-indigo-500'],
    ['Accepted', outcomes.accepted, 'bg-emerald-500'],
    ['Rejected', outcomes.rejected, 'bg-rose-400'],
    ['Withdrawn', outcomes.withdrawn, 'bg-slate-400'],
  ];
  const total = items.reduce((sum, [, n]) => sum + n, 0) || 1;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {items.map(([label, n, color]) => n > 0 && <div key={label} className={color} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} />)}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {items.map(([label, n, color]) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`size-2.5 rounded-sm ${color}`} aria-hidden="true" />
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="ml-auto text-sm font-semibold tabular-nums text-slate-900">{n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ByCompany({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="pb-2">Company</th>
            {STAGES.map((s) => (
              <th key={s.key} className="w-24 pb-2 text-right">
                {s.key === 'oa' ? 'OA' : s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.company}>
              <td className="py-2 font-medium text-slate-900">{row.company}</td>
              {STAGES.map((s) => (
                <td key={s.key} className={`py-2 text-right tabular-nums ${row[s.key] ? 'text-slate-900' : 'text-slate-300'}`}>
                  {row[s.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Insights() {
  const [range, setRange] = useState('all');
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const from = useMemo(() => RANGES.find((r) => r.id === range).from(), [range]);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api.analytics
      .applications({ from: from?.toISOString(), months: 6 }, controller.signal)
      .then(({ data }) => setState({ loading: false, data, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, loading: false, error: err.message })));
    return () => controller.abort();
  }, [from]);

  const data = state.data;
  const empty = data && data.funnel.applied === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-1 text-slate-600">How your applications convert, and where you get the best responses.</p>
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${range === r.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}
            >
              {r.label}
            </button>
          ))}
        </nav>
      </header>

      {state.error && <Alert>{state.error}</Alert>}
      {state.loading && !data && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <div className={`space-y-6 transition-opacity ${state.loading ? 'opacity-60' : ''}`}>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Applications" value={data.funnel.applied} hint={range === 'all' ? 'all time' : RANGES.find((r) => r.id === range).label.toLowerCase()} />
            <Stat label="Response rate" value={percent(data.responseRate)} hint="heard back at all (OA, interview, offer or rejection)" />
            <Stat label="Interview rate" value={percent(data.conversion.appliedToInterview)} hint="of applications reached an interview" />
            <Stat label="Offers" value={data.outcomes.offers} hint={`${percent(data.conversion.interviewToOffer)} of interviews converted`} />
          </section>

          {empty ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <p className="font-medium text-slate-900">No applications in this period</p>
              <p className="mt-1 text-sm text-slate-600">
                Mark jobs as applied from{' '}
                <Link to="/applications" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Applications
                </Link>{' '}
                and your funnel will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Funnel" subtitle="Applications that reached each stage (skipped stages are not counted)">
                <Funnel funnel={data.funnel} />
              </Card>
              <Card title="Outcomes" subtitle="Where those applications stand today">
                <Outcomes outcomes={data.outcomes} />
              </Card>
            </div>
          )}

          <Card title="Monthly activity" subtitle="Last 6 months, regardless of the range above">
            <MonthlyChart monthly={data.monthly} />
          </Card>

          {data.byCompany.length > 0 && (
            <Card title="By company" subtitle="Top companies by number of applications">
              <ByCompany rows={data.byCompany} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
