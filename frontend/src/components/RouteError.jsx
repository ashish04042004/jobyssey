import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

export default function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : 'Something went wrong.';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="text-slate-600">Try reloading the page. If it keeps happening, let us know.</p>
      <Link to="/" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
        Back to dashboard
      </Link>
    </div>
  );
}
