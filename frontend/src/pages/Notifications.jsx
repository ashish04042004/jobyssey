import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button } from '../components/ui.jsx';
import { notifyNotificationsChanged } from '../hooks/useUnreadCount.js';
import { timeAgo } from '../lib/format.js';
import { api } from '../services/api.js';

const TYPES = {
  INTERVIEW: { icon: '🎯', tone: 'bg-violet-50' },
  DEADLINE: { icon: '⏳', tone: 'bg-rose-50' },
  JOB_MATCH: { icon: '✨', tone: 'bg-indigo-50' },
  STALE_APPLICATION: { icon: '📌', tone: 'bg-amber-50' },
  SYSTEM: { icon: '🔔', tone: 'bg-slate-100' },
};

export default function Notifications() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const unreadOnly = params.get('filter') === 'unread';
  const [state, setState] = useState({ loading: true, items: [], unread: 0, nextCursor: null, error: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api.notifications
      .list({ unread: unreadOnly || undefined }, controller.signal)
      .then(({ data, meta }) => setState({ loading: false, items: data, unread: meta.unread, nextCursor: meta.nextCursor, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, loading: false, error: err.message })));
    return () => controller.abort();
  }, [unreadOnly]);

  const loadMore = async () => {
    setBusy(true);
    try {
      const { data, meta } = await api.notifications.list({ unread: unreadOnly || undefined, cursor: state.nextCursor });
      setState((prev) => ({ ...prev, items: [...prev.items, ...data], nextCursor: meta.nextCursor }));
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      await api.notifications.markAllRead();
      const now = new Date().toISOString();
      setState((prev) => ({ ...prev, unread: 0, items: unreadOnly ? [] : prev.items.map((n) => ({ ...n, readAt: n.readAt ?? now })) }));
      notifyNotificationsChanged();
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setBusy(false);
    }
  };

  const open = async (notification) => {
    if (!notification.readAt) {
      api.notifications.markRead(notification.id).then(notifyNotificationsChanged).catch(() => {});
    }
    if (notification.link) navigate(notification.link);
    else {
      setState((prev) => ({
        ...prev,
        unread: Math.max(0, prev.unread - (notification.readAt ? 0 : 1)),
        items: prev.items.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)),
      }));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-slate-600">Reminders before rounds and deadlines, new matching jobs, and nudges.</p>
        </div>
        {state.unread > 0 && (
          <Button variant="secondary" loading={busy} onClick={markAllRead}>
            Mark all as read
          </Button>
        )}
      </header>

      <nav className="flex gap-1" aria-label="Filter notifications">
        {[
          ['', 'All'],
          ['unread', `Unread${state.unread ? ` (${state.unread})` : ''}`],
        ].map(([key, label]) => {
          const active = (params.get('filter') ?? '') === key;
          return (
            <button
              key={key || 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => setParams(key ? { filter: key } : {}, { replace: true })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {state.error && <Alert>{state.error}</Alert>}

      {!state.loading && state.items.length === 0 && !state.error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium text-slate-900">{unreadOnly ? "You're all caught up" : 'No notifications yet'}</p>
          <p className="mt-1 text-sm text-slate-600">
            Schedule OAs and interviews, save jobs with deadlines, and set your preferences to get matched with new openings.
          </p>
        </div>
      )}

      <ul className={`divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white transition-opacity ${state.loading ? 'opacity-60' : ''} ${state.items.length ? '' : 'hidden'}`}>
        {state.items.map((notification) => {
          const type = TYPES[notification.type] ?? TYPES.SYSTEM;
          const unread = !notification.readAt;
          return (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => open(notification)}
                className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 ${unread ? 'bg-indigo-50/40' : ''}`}
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${type.tone}`} aria-hidden="true">
                  {type.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${unread ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{notification.title}</span>
                  {notification.body && <span className="mt-0.5 block text-sm text-slate-500">{notification.body}</span>}
                  <span className="mt-1 block text-xs text-slate-400">{timeAgo(notification.createdAt)}</span>
                </span>
                {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-indigo-600" aria-label="Unread" />}
              </button>
            </li>
          );
        })}
      </ul>

      {state.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={busy} onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
