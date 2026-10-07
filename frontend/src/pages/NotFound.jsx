import { Link } from 'react-router';

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-slate-600">This stop isn't on your journey.</p>
      <Link to="/" className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500">
        Back to dashboard →
      </Link>
    </div>
  );
}
