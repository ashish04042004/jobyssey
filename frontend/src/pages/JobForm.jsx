import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.js';
import FullPageLoader from '../components/FullPageLoader.jsx';
import TagInput from '../components/TagInput.jsx';
import { Alert, Button, Field, Input, Select } from '../components/ui.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { EMPLOYMENT_TYPES, fromLocalInput, ROLE_CATEGORIES, toLocalInput } from '../lib/format.js';
import { ApiError, api } from '../services/api.js';

const THIS_YEAR = new Date().getFullYear();
const BATCHES = [THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1, THIS_YEAR + 2];
const LOCATION_SUGGESTIONS = ['Bengaluru', 'Hyderabad', 'Pune', 'Noida', 'Gurugram', 'Mumbai', 'Chennai'];

const EMPTY = {
  companyName: '',
  title: '',
  roleCategory: '',
  employmentType: 'FULL_TIME',
  locations: [],
  isRemote: false,
  ctcMinLpa: '',
  ctcMaxLpa: '',
  graduationYears: [],
  applicationDeadline: '',
  jobUrl: '',
  eligibility: '',
  description: '',
  visibility: 'PRIVATE',
};

const fromJob = (job) => ({
  companyName: job.company.name,
  title: job.title,
  roleCategory: job.roleCategory ?? '',
  employmentType: job.employmentType,
  locations: job.locations,
  isRemote: job.isRemote,
  ctcMinLpa: job.ctcMinLpa ?? '',
  ctcMaxLpa: job.ctcMaxLpa ?? '',
  graduationYears: job.graduationYears,
  applicationDeadline: toLocalInput(job.applicationDeadline),
  jobUrl: job.jobUrl ?? '',
  eligibility: job.eligibility ?? '',
  description: job.description ?? '',
  visibility: job.visibility,
});

function toPayload(form) {
  const number = (value) => (value === '' ? null : Number(value));
  return {
    ...form,
    roleCategory: form.roleCategory || null,
    ctcMinLpa: number(form.ctcMinLpa),
    ctcMaxLpa: number(form.ctcMaxLpa),
    applicationDeadline: fromLocalInput(form.applicationDeadline),
  };
}

function CompanyField({ value, onChange, error }) {
  const listId = useId();
  const [options, setOptions] = useState([]);
  const query = useDebouncedValue(value, 200);

  useEffect(() => {
    if (query.trim().length < 2) return setOptions([]);
    const controller = new AbortController();
    api.companies
      .search(query.trim(), controller.signal)
      .then(({ data }) => setOptions(data))
      .catch(() => {});
    return () => controller.abort();
  }, [query]);

  return (
    <>
      <Input list={listId} value={value} onChange={(e) => onChange(e.target.value)} error={error} placeholder="Microsoft" autoComplete="off" />
      <datalist id={listId}>
        {options.map((company) => (
          <option key={company.id} value={company.name} />
        ))}
      </datalist>
    </>
  );
}

export default function JobForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'ADMIN';

  const [form, setForm] = useState(editing ? null : { ...EMPTY, visibility: isAdmin ? 'PUBLIC' : 'PRIVATE' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!editing) return undefined;
    const controller = new AbortController();
    api.jobs
      .get(id, controller.signal)
      .then(({ data }) => (data.canEdit ? setForm(fromJob(data)) : setError('You can only edit jobs you added.')))
      .catch((err) => err.name !== 'AbortError' && setError(err.message));
    return () => controller.abort();
  }, [editing, id]);

  if (!form) return error ? <Alert>{error}</Alert> : <FullPageLoader />;

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const bind = (field) => ({ value: form[field], onChange: (e) => set(field, e.target.value), error: fieldErrors[field] });

  const toggleBatch = (year) =>
    set('graduationYears', form.graduationYears.includes(year) ? form.graduationYears.filter((y) => y !== year) : [...form.graduationYears, year].sort());

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = toPayload(form);
      if (!isAdmin) delete payload.visibility;
      const { data } = editing ? await api.jobs.update(id, payload) : await api.jobs.create(payload);
      navigate(`/jobs/${data.id}`, { replace: editing });
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setError(err instanceof ApiError && err.code === 'VALIDATION_ERROR' ? 'Please fix the highlighted fields.' : err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div>
        <Link to={editing ? `/jobs/${id}` : '/jobs'} className="text-sm font-medium text-slate-600 hover:text-slate-900">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{editing ? 'Edit job' : 'Add a job'}</h1>
        {!isAdmin && !editing && (
          <p className="mt-1 text-slate-600">Track an opening you found elsewhere. Only you will see it.</p>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" error={fieldErrors.companyName}>
            <CompanyField value={form.companyName} onChange={(v) => set('companyName', v)} error={fieldErrors.companyName} />
          </Field>
          <Field label="Job title" error={fieldErrors.title}>
            <Input placeholder="Software Engineer" {...bind('title')} />
          </Field>
          <Field label="Role category" error={fieldErrors.roleCategory} hint="Used for matching against preferred roles.">
            <Select {...bind('roleCategory')}>
              <option value="">Not specified</option>
              {ROLE_CATEGORIES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" error={fieldErrors.employmentType}>
            <Select {...bind('employmentType')}>
              {Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Locations" error={fieldErrors.locations}>
          <TagInput value={form.locations} onChange={(v) => set('locations', v)} suggestions={LOCATION_SUGGESTIONS} placeholder="Type a city and press Enter" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.isRemote} onChange={(e) => set('isRemote', e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
          Remote-friendly
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Min CTC (LPA)" error={fieldErrors.ctcMinLpa}>
            <Input type="number" min="0" step="0.5" {...bind('ctcMinLpa')} />
          </Field>
          <Field label="Max CTC (LPA)" error={fieldErrors.ctcMaxLpa}>
            <Input type="number" min="0" step="0.5" {...bind('ctcMaxLpa')} />
          </Field>
          <Field label="Application deadline" error={fieldErrors.applicationDeadline}>
            <Input type="datetime-local" {...bind('applicationDeadline')} />
          </Field>
        </div>

        <Field label="Eligible batches" error={fieldErrors.graduationYears} hint="Leave all unchecked if any batch can apply.">
          <div className="flex flex-wrap gap-2">
            {BATCHES.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => toggleBatch(year)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  form.graduationYears.includes(year)
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Job posting link" error={fieldErrors.jobUrl}>
          <Input type="url" placeholder="https://careers.example.com/…" {...bind('jobUrl')} />
        </Field>
        <Field label="Eligibility" error={fieldErrors.eligibility}>
          <textarea rows={2} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" {...bind('eligibility')} />
        </Field>
        <Field label="Description" error={fieldErrors.description}>
          <textarea rows={6} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" {...bind('description')} />
        </Field>

        {isAdmin && (
          <Field label="Visibility">
            <Select {...bind('visibility')}>
              <option value="PUBLIC">Public — every student sees it</option>
              <option value="PRIVATE">Private — only me</option>
            </Select>
          </Field>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Link to={editing ? `/jobs/${id}` : '/jobs'} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancel
        </Link>
        <Button type="submit" loading={saving}>
          {editing ? 'Save changes' : 'Add job'}
        </Button>
      </div>
    </form>
  );
}
