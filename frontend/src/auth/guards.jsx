import { Navigate, useLocation } from 'react-router';
import FullPageLoader from '../components/FullPageLoader.jsx';
import { useAuth } from './AuthContext.js';

export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

export function PublicOnly({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;
  return children;
}
