import { formatDate, STATUS_LABELS } from '../../lib/format.js';
import { STATUS_DOTS } from './StatusBadge.jsx';

function describe(event) {
  if (!event.fromStatus) return event.toStatus === 'SAVED' ? 'Saved to tracker' : `Started tracking as ${STATUS_LABELS[event.toStatus]}`;
  return `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`;
}

export default function Timeline({ events }) {
  const newestFirst = [...events].reverse();
  return (
    <ol className="relative space-y-5 border-l border-slate-200 pl-6">
      {newestFirst.map((event) => (
        <li key={event.id} className="relative">
          <span className={`absolute -left-[31px] top-1 size-3 rounded-full ring-4 ring-white ${STATUS_DOTS[event.toStatus]}`} />
          <p className="text-sm font-medium text-slate-900">{describe(event)}</p>
          <time dateTime={event.occurredAt} className="text-xs text-slate-500">
            {formatDate(event.occurredAt, true)}
          </time>
          {event.note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}
