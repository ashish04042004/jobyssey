const SIGNALS = [
  ['role', 'Role', 30],
  ['location', 'Location', 25],
  ['graduation', 'Graduation year', 25],
  ['salary', 'CTC', 20],
];

function tone(score) {
  if (score >= 80) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (score >= 50) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

export default function MatchBadge({ score, breakdown }) {
  const explanation = SIGNALS.map(([key, label, max]) => `${label}: ${breakdown[key]}/${max}`).join('\n');
  return (
    <span
      title={explanation}
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone(score)}`}
    >
      {score}% match
    </span>
  );
}

export function MatchBreakdown({ breakdown }) {
  return (
    <dl className="space-y-3">
      {SIGNALS.map(([key, label, max]) => (
        <div key={key}>
          <div className="flex justify-between text-sm">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium text-slate-900">
              {breakdown[key]}/{max}
            </dd>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
            <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(breakdown[key] / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </dl>
  );
}
