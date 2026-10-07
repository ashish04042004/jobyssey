import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

const POLL_MS = 60_000;
const CHANGED = 'jobyssey:notifications-changed';

/** Call after marking notifications read so every badge refreshes at once. */
export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

/** Unread notification count, refreshed every minute, on tab focus and on local changes. */
export function useUnreadCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let controller = null;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      api.notifications
        .unreadCount(controller.signal)
        .then(({ data }) => setCount(data.count))
        .catch(() => {});
    };

    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener(CHANGED, refresh);
    return () => {
      clearInterval(timer);
      controller?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(CHANGED, refresh);
    };
  }, []);

  return count;
}
