import { createBrowserRouter } from 'react-router';
import { PublicOnly, RequireAuth } from './auth/guards.jsx';
import AppLayout from './components/AppLayout.jsx';
import Admin from './pages/Admin.jsx';
import ApplicationDetail from './pages/ApplicationDetail.jsx';
import Applications from './pages/Applications.jsx';
import RouteError from './components/RouteError.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Documents from './pages/Documents.jsx';
import Insights from './pages/Insights.jsx';
import Interviews from './pages/Interviews.jsx';
import JobDetail from './pages/JobDetail.jsx';
import JobForm from './pages/JobForm.jsx';
import Jobs from './pages/Jobs.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Notifications from './pages/Notifications.jsx';
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
          { path: 'applications', element: <Applications /> },
          { path: 'applications/:id', element: <ApplicationDetail /> },
          { path: 'interviews', element: <Interviews /> },
          { path: 'notifications', element: <Notifications /> },
          { path: 'documents', element: <Documents /> },
          { path: 'insights', element: <Insights /> },
          { path: 'admin', element: <Admin /> },
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
