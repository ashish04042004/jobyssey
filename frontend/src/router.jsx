import { createBrowserRouter } from 'react-router';
import { PublicOnly, RequireAuth } from './auth/guards.jsx';
import AppLayout from './components/AppLayout.jsx';
import RouteError from './components/RouteError.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Dashboard from './pages/Dashboard.jsx';
import JobDetail from './pages/JobDetail.jsx';
import JobForm from './pages/JobForm.jsx';
import Jobs from './pages/Jobs.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Profile from './pages/Profile.jsx';
import Register from './pages/Register.jsx';
import { MODULES } from './modules.js';

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <PublicOnly><Login /></PublicOnly> },
      { path: '/register', element: <PublicOnly><Register /></PublicOnly> },
      {
        path: '/',
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'jobs', element: <Jobs /> },
          { path: 'jobs/new', element: <JobForm key="new" /> },
          { path: 'jobs/:id', element: <JobDetail /> },
          { path: 'jobs/:id/edit', element: <JobForm key="edit" /> },
          ...MODULES.filter((m) => !m.ready).map((module) => ({
            path: module.path.slice(1),
            element: <ComingSoon module={module} />,
          })),
          { path: 'profile', element: <Profile /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
