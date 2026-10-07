import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import TagInput from '../components/TagInput.jsx';
import { Alert, Button, Field, Input, Select } from '../components/ui.jsx';
import { ApiError, api } from '../services/api.js';

const THIS_YEAR = new Date().getFullYear();
const GRADUATION_YEARS = Array.from({ length: 9 }, (_, i) => THIS_YEAR - 4 + i);
const ROLE_SUGGESTIONS = ['SDE', 'Backend', 'Frontend', 'Full Stack', 'Data', 'ML', 'DevOps', 'Android', 'Product'];
const LOCATION_SUGGESTIONS = ['Bengaluru', 'Hyderabad', 'Pune', 'Delhi NCR', 'Mumbai', 'Chennai', 'Remote'];

const toForm = (user) => ({
  name: user.name,
  college: user.college,
  degree: user.degree ?? '',
  branch: user.branch,
  graduationYear: user.graduationYear,
  preferredRoles: user.preferredRoles,
  preferredLocations: user.preferredLocations,
  minCtcLpa: user.minCtcLpa ?? '',
  skills: user.skills,
});

function Section({ title, description, children }) {
  return (
    <section className="grid gap-6 border-b border-slate-200 py-8 last:border-0 md:grid-cols-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="space-y-4 md:col-span-2">{children}</div>
    </section>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState(() => toForm(user));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const bind = (field) => ({ value: form[field], onChange: (event) => set(field, event.target.value) });

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    setFieldErrors({});
    try {
      const { data } = await api.updateMe({
        ...form,
        degree: form.degree.trim() || null,
        graduationYear: Number(form.graduationYear),
        minCtcLpa: form.minCtcLpa === '' ? null : Number(form.minCtcLpa),
      });
      setUser(data);
      setForm(toForm(data));
      setStatus({ tone: 'success', message: 'Profile saved.' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save. Check your connection.';
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setStatus({ tone: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-slate-600">{user.email}</p>
        </div>
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
      </header>

      {status && (
        <div className="mt-6">
          <Alert tone={status.tone}>{status.message}</Alert>
        </div>
      )}

      <div className="mt-2">
        <Section title="Academic details" description="Used to check eligibility for openings.">
          <Field label="Full name" error={fieldErrors.name}>
            <Input {...bind('name')} error={fieldErrors.name} />
          </Field>
          <Field label="College" error={fieldErrors.college}>
            <Input {...bind('college')} error={fieldErrors.college} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Degree" error={fieldErrors.degree}>
              <Input placeholder="B.Tech" {...bind('degree')} error={fieldErrors.degree} />
            </Field>
            <Field label="Branch" error={fieldErrors.branch}>
              <Input {...bind('branch')} error={fieldErrors.branch} />
            </Field>
            <Field label="Graduation year" error={fieldErrors.graduationYear}>
              <Select {...bind('graduationYear')}>
                {GRADUATION_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section
          title="Job preferences"
          description="Jobyssey ranks opportunities by how well they match these. Leave blank if you're open to anything."
        >
          <Field label="Preferred roles" error={fieldErrors.preferredRoles}>
            <TagInput
              value={form.preferredRoles}
              onChange={(value) => set('preferredRoles', value)}
              suggestions={ROLE_SUGGESTIONS}
              placeholder="Type a role and press Enter"
            />
          </Field>
          <Field label="Preferred locations" error={fieldErrors.preferredLocations}>
            <TagInput
              value={form.preferredLocations}
              onChange={(value) => set('preferredLocations', value)}
              suggestions={LOCATION_SUGGESTIONS}
              placeholder="Type a city and press Enter"
            />
          </Field>
          <Field label="Minimum CTC (LPA)" error={fieldErrors.minCtcLpa} hint="Offers below this score lower.">
            <Input type="number" min="0" max="999" step="0.5" {...bind('minCtcLpa')} className="max-w-40" />
          </Field>
        </Section>

        <Section title="Skills" description="Optional. Helps you spot gaps when preparing for a company.">
          <Field label="Skills" error={fieldErrors.skills}>
            <TagInput
              value={form.skills}
              onChange={(value) => set('skills', value)}
              max={30}
              placeholder="Java, React, SQL…"
            />
          </Field>
        </Section>
      </div>
    </form>
  );
}
