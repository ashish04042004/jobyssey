import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
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

function Pipeline() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.applications
      .list({ limit: 1 }, controller.signal)
      .then(({ meta }) => setCounts(meta.counts))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <Card title="Application pipeline">
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
    </Card>
  );
}

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user.name.split(/\s+/)[0];
  const hasPreferences = user.preferredRoles.length > 0 || user.preferredLocations.length > 0;

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

          <Recommendations />

          <Pipeline />
        </div>

        <SystemStatus />
      </div>
    </div>
  );
}
