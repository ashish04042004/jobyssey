import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, session } from '../services/api.js';
import { AuthContext } from './AuthContext.js';

export default function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;
    session.onExpired(() => setState({ status: 'anonymous', user: null }));

    (async () => {
      try {
        await refreshSession();
        const { data } = await api.me();
        if (!cancelled) setState({ status: 'authenticated', user: data });
      } catch {
        if (!cancelled) setState({ status: 'anonymous', user: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = useCallback(({ user, accessToken }) => {
    session.setAccessToken(accessToken);
    setState({ status: 'authenticated', user });
  }, []);

  const login = useCallback(async (credentials) => startSession((await api.login(credentials)).data), [startSession]);

  const register = useCallback(async (details) => startSession((await api.register(details)).data), [startSession]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      session.clear();
      setState({ status: 'anonymous', user: null });
    }
  }, []);

  const setUser = useCallback((user) => setState((prev) => ({ ...prev, user })), []);

  const value = useMemo(
    () => ({ ...state, login, register, logout, setUser }),
    [state, login, register, logout, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
