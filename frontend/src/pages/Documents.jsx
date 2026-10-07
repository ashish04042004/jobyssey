import { useEffect, useState } from 'react';
import DocumentRow from '../components/documents/DocumentRow.jsx';
import UploadPanel from '../components/documents/UploadPanel.jsx';
import { Alert } from '../components/ui.jsx';
import { DOCUMENT_TYPES } from '../lib/format.js';
import { api } from '../services/api.js';

const SECTION_TITLES = { RESUME: 'Resumes', COVER_LETTER: 'Cover letters', OTHER: 'Other' };

export default function Documents() {
  const [state, setState] = useState({ loading: true, items: [], limit: 20, error: null });

  useEffect(() => {
    const controller = new AbortController();
    api.documents
      .list({}, controller.signal)
      .then(({ data, meta }) => setState({ loading: false, items: data, limit: meta.limit, error: null }))
      .catch((err) => err.name !== 'AbortError' && setState((prev) => ({ ...prev, loading: false, error: err.message })));
    return () => controller.abort();
  }, []);

  const setError = (error) => setState((prev) => ({ ...prev, error }));
  const replace = (doc) => setState((prev) => ({ ...prev, items: prev.items.map((d) => (d.id === doc.id ? doc : d)) }));
  const removeItem = (id) => setState((prev) => ({ ...prev, items: prev.items.filter((d) => d.id !== id) }));

  const full = state.items.length >= state.limit;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-slate-600">Keep each version of your resume and attach the one you used to every application.</p>
        </div>
        {!state.loading && (
          <span className="text-sm text-slate-500">
            {state.items.length} of {state.limit} used
          </span>
        )}
      </header>

      <UploadPanel
        disabled={full}
        onUploaded={(doc) => setState((prev) => ({ ...prev, error: null, items: [doc, ...prev.items] }))}
      />

      {state.error && <Alert>{state.error}</Alert>}

      {!state.loading && state.items.length === 0 && !state.error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-slate-900">No documents yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Upload a resume tailored for each kind of role — backend, frontend, data — and pick the right one per application.
          </p>
        </div>
      )}

      {Object.keys(DOCUMENT_TYPES).map((type) => {
        const items = state.items.filter((d) => d.type === type);
        if (!items.length) return null;
        return (
          <section key={type} className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {SECTION_TITLES[type]} <span className="font-normal text-slate-500">({items.length})</span>
            </h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {items.map((doc) => (
                <DocumentRow key={doc.id} document={doc} onChanged={replace} onRemoved={removeItem} onError={setError} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
