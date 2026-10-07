import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import AuthLayout from '../components/AuthLayout.jsx';
import { Alert, Button, Field, Input } from '../components/ui.jsx';
import { ApiError } from '../services/api.js';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(form);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Jobyssey. Check your connection.');
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to see what's due today."
      footer={
        <>
          New to Jobyssey?{' '}
          <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={form.email} onChange={update('email')} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={update('password')}
          />
        </Field>
        <Button type="submit" loading={submitting} className="w-full">
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
