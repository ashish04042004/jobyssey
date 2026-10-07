import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import AuthLayout from '../components/AuthLayout.jsx';
import { Alert, Button, Field, Input, Select } from '../components/ui.jsx';
import { ApiError } from '../services/api.js';

const THIS_YEAR = new Date().getFullYear();
const GRADUATION_YEARS = Array.from({ length: 7 }, (_, i) => THIS_YEAR - 2 + i);

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    college: '',
    branch: '',
    graduationYear: THIS_YEAR,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const onSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await register({ ...form, graduationYear: Number(form.graduationYear) });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError(err.code === 'VALIDATION_ERROR' ? 'Please fix the highlighted fields.' : err.message);
      } else {
        setError('Could not reach Jobyssey. Check your connection.');
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Track every application, OA and interview in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" error={fieldErrors.name}>
          <Input autoComplete="name" value={form.name} onChange={update('name')} error={fieldErrors.name} />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <Input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
            error={fieldErrors.email}
          />
        </Field>
        <Field label="Password" error={fieldErrors.password} hint="At least 10 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            error={fieldErrors.password}
          />
        </Field>
        <Field label="College" error={fieldErrors.college}>
          <Input
            placeholder="IIT (ISM) Dhanbad"
            value={form.college}
            onChange={update('college')}
            error={fieldErrors.college}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Branch" error={fieldErrors.branch}>
            <Input placeholder="CSE" value={form.branch} onChange={update('branch')} error={fieldErrors.branch} />
          </Field>
          <Field label="Graduation year" error={fieldErrors.graduationYear}>
            <Select value={form.graduationYear} onChange={update('graduationYear')}>
              {GRADUATION_YEARS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
