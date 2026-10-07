import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { describeDeadline, describeWhen, INTERVIEW_TYPES, startOfToday } from '../lib/format.js';
import { api } from '../services/api.js';

const DAYS_AHEAD = 7;
const MAX_ITEMS = 6;

const KIND = {
  OA: { icon: '📝', tone: 'bg-amber-50' },
  INTERVIEW: { icon: '🎯', tone: 'bg-violet-50' },
  DEADLINE: { icon: '⏳', tone: 'bg-rose-50' },
};

function describe(item) {
  if (item.kind === 'DEADLINE') {
    return { title: `${item.job.company.name} · apply for ${item.job.title}`, when: describeDeadline(item.at)?.label ?? '' };
  }
  const what = item.interview.title || INTERVIEW_TYPES[item.interview.type];
  return { title: `${item.job.company.name} · ${what}`, when: describeWhen(item.at) };
}

export default function TodayAgenda() {
  const [state, setState] = useState({ loading: true, items: [], error: null });

  useEffect(() => {
    const controller = new AbortController();
    const from = startOfToday();
    const to = new Date(from.getTime() + (DAYS_AHEAD + 1) * 86_400_000);
    api
      .agenda({ from: from.toISOString(), to: to.toISOString() }, controller.signal)
      .then(({ data }) => {
        // Today's rounds that already finished are history, not to-dos.
        const now = Date.now();
        const items = data.filter((item) => item.kind === 'DEADLINE' || new Date(item.interview.endsAt ?? item.at).getTime() + 3_600_000 > now);
        setState({ loading: false, items, error: null });
      })
      .catch((err) => err.name !== 'AbortError' && setState({ loading: false, items: [], error: err.message }));
    return () => controller.abort();
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Coming up</h2>
        <Link to="/interviews" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          Calendar →
        </Link>
      </div>

      {state.loading && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
      {state.error && <p className="mt-3 text-sm text-rose-600">{state.error}</p>}
      {!state.loading && !state.error && state.items.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Nothing in the next {DAYS_AHEAD} days. OAs, interviews and deadlines for jobs you've saved will show up here.
        </p>
      )}

      <ul className="mt-3 divide-y divide-slate-100">
        {state.items.slice(0, MAX_ITEMS).map((item) => {
          const { title, when } = describe(item);
          const kind = KIND[item.kind];
          const key = item.interview?.id ?? `deadline-${item.application.id}`;
          return (
            <li key={key} className="flex items-center gap-3 py-2.5">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${kind.tone}`} aria-hidden="true">
                {kind.icon}
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`/applications/${item.application.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">
                  {title}
                </Link>
                <p className="text-xs text-slate-500">{when}</p>
              </div>
              {item.interview?.meetingUrl && (
                <a
                  href={item.interview.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {item.kind === 'OA' ? 'Open test' : 'Join'}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {state.items.length > MAX_ITEMS && (
        <p className="mt-2 text-xs text-slate-500">+{state.items.length - MAX_ITEMS} more this week</p>
      )}
    </section>
  );
}
