import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import StatusBadge from '../components/applications/StatusBadge.jsx';
import Recommendations from '../components/jobs/Recommendations.jsx';
import SystemStatus from '../components/SystemStatus.jsx';
import TodayAgenda from '../components/TodayAgenda.jsx';
import { api } from '../services/api.js';

const PIPELINE = [
  { label: 'Saved', statuses: ['SAVED'] },
  { label: 'Applied', statuses: ['APPLIED'] },
  { label: 'OA', statuses: ['OA', 'OA_COMPLETED'] },
  { label: 'Interview', statuses: ['INTERVIEW'] },
  { label: 'Offer', statuses: ['OFFER', 'ACCEPTED'] },
];

function Card({ title, aside, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Pipeline({ summary }) {
  const counts = summary?.pipeline;
  const month = summary?.thisMonth;
  return (
    <Card
      title="Application pipeline"
      aside={
        <Link to="/insights" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          Insights →
        </Link>
      }
    >
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {PIPELINE.map(({ label, statuses }) => (
          <Link
            key={label}
            to={`/applications?status=${statuses[0]}`}
            className="rounded-lg bg-slate-50 px-3 py-2 transition-colors hover:bg-indigo-50"
          >
            <span className="block text-xs font-medium text-slate-500">{label}</span>
            <span className="mt-1 block text-xl font-semibold text-slate-900">
              {counts ? statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : '–'}
            </span>
          </Link>
        ))}
      </div>
      {month && (
        <p className="mt-4 text-sm text-slate-600">
          This month: <span className="font-medium text-slate-900">{month.applications}</span> applied ·{' '}
          <span className="font-medium text-slate-900">{month.interviews}</span> rounds ·{' '}
          <span className="font-medium text-slate-900">{month.offers}</span> {month.offers === 1 ? 'offer' : 'offers'}
        </p>
      )}
    </Card>
  );
}

function FollowUps({ items }) {
  if (!items?.length) return null;
  return (
    <Card title="Needs a follow-up">
      <p className="mt-1 text-xs text-slate-500">No update in 2+ weeks. A polite nudge to the recruiter often helps.</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="py-2.5">
            <Link to={`/applications/${item.id}`} className="flex items-center gap-2 hover:text-indigo-700">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{item.company}</span>
              <StatusBadge status={item.status} />
            </Link>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {item.title} · {item.daysSinceUpdate} days quiet
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user.name.split(/\s+/)[0];
  const hasPreferences = user.preferredRoles.length > 0 || user.preferredLocations.length > 0;
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.analytics
      .dashboard(controller.signal)
      .then(({ data }) => setSummary(data))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}, {firstName} 👋
        </h1>
        <p className="mt-1 text-slate-600">Here's what needs your attention today.</p>
      </header>

      {!hasPreferences && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4">
          <p className="text-sm text-indigo-900">
            Tell us the roles and locations you're targeting so Jobyssey can rank opportunities for you.
          </p>
          <Link
            to="/profile"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Set preferences
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TodayAgenda />
          <Pipeline summary={summary} />
          <Recommendations />
        </div>

        <div className="space-y-6">
          <FollowUps items={summary?.staleApplications} />
          <SystemStatus />
        </div>
      </div>
    </div>
  );
}
