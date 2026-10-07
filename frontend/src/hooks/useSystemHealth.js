import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../services/api.js';

const REFRESH_MS = 30_000;

export function useSystemHealth() {
  const [state, setState] = useState({ loading: true, health: null, error: null });

  const load = useCallback(async (signal) => {
    try {
      const { data } = await api.health(signal);
      setState({ loading: false, health: data, error: null });
    } catch (err) {
      if (err.name === 'AbortError') return;
      // A 503 still carries the per-dependency breakdown.
      const health = err instanceof ApiError ? (err.body?.data ?? null) : null;
      setState({ loading: false, health, error: health ? null : 'API unreachable' });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  return state;
}
