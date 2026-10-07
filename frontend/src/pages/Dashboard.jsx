import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import SystemStatus from '../components/SystemStatus.jsx';

const PIPELINE = ['Saved', 'Applied', 'OA', 'Interview', 'Offer'];

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
          <Card title="Today">
            <p className="mt-3 text-sm text-slate-500">
              Nothing due yet. Upcoming OAs, interviews and application deadlines will show up here.
            </p>
          </Card>

          <Card title="Application pipeline">
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {PIPELINE.map((stage) => (
                <div key={stage} className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-xs font-medium text-slate-500">{stage}</dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-900">0</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <SystemStatus />
      </div>
    </div>
  );
}
