import { useSystemHealth } from '../hooks/useSystemHealth.js';

const DOT = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  error: 'bg-rose-500',
  unknown: 'bg-slate-300',
};

const LABELS = { database: 'Database', redis: 'Redis', worker: 'Background worker' };

function Row({ label, status, hint }) {
  return (
    <li className="flex items-center justify-between py-2 text-sm">
      <span className="flex items-center gap-2 text-slate-700">
        <span className={`size-2 rounded-full ${DOT[status] ?? DOT.unknown}`} />
        {label}
      </span>
      <span className="text-slate-500">{hint}</span>
    </li>
  );
}

export default function SystemStatus() {
  const { loading, health, error } = useSystemHealth();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">System status</h2>
        {!loading && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              health?.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {health?.status === 'ok' ? 'All systems go' : 'Issues detected'}
          </span>
        )}
      </div>

      {loading && <p className="mt-3 text-sm text-slate-500">Checking…</p>}
      {error && <p className="mt-3 text-sm text-rose-600">{error}. Is the backend running on port 4001?</p>}

      {health && (
        <ul className="mt-2 divide-y divide-slate-100">
          {Object.entries(health.checks).map(([name, check]) => (
            <Row
              key={name}
              label={LABELS[name] ?? name}
              status={check.status}
              hint={
                check.latencyMs !== undefined
                  ? `${check.latencyMs} ms`
                  : check.lastHeartbeatAt
                    ? `seen ${new Date(check.lastHeartbeatAt).toLocaleTimeString()}`
                    : (check.error ?? check.status)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
