import { useRef, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '../ui.jsx';
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES, formatBytes, MAX_DOCUMENT_BYTES } from '../../lib/format.js';
import { api } from '../../services/api.js';

const stripExtension = (name) => name.replace(/\.[^.]+$/, '');

function validate(file) {
  if (!DOCUMENT_ACCEPT[file.type]) return 'Only PDF and DOCX files are supported.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_DOCUMENT_BYTES) return `That file is ${formatBytes(file.size)}; the limit is 5 MB.`;
  return null;
}

export default function UploadPanel({ disabled, onUploaded }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState('RESUME');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const choose = (picked) => {
    if (!picked) return;
    const problem = validate(picked);
    setError(problem);
    if (problem) return;
    setFile(picked);
    setLabel(stripExtension(picked.name).slice(0, 80));
    setType(/cover/i.test(picked.name) ? 'COVER_LETTER' : 'RESUME');
  };

  const reset = () => {
    setFile(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setProgress(0);
    try {
      const { data } = await api.documents.upload(file, { label: label.trim(), type }, setProgress);
      reset();
      onUploaded(data);
    } catch (err) {
      setProgress(null);
      setError(err.message);
    }
  };

  const uploading = progress !== null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <input
        ref={inputRef}
        type="file"
        accept={Object.keys(DOCUMENT_ACCEPT).join(',') + ',.pdf,.docx'}
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />

      {!file ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) choose(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:border-indigo-300 hover:bg-slate-50'
          }`}
        >
          <span className="text-sm font-medium text-slate-900">
            {disabled ? 'You have reached the 20-document limit' : 'Drop a PDF or DOCX here, or click to browse'}
          </span>
          <span className="text-xs text-slate-500">Up to 5 MB. Files are private to you.</span>
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              {DOCUMENT_ACCEPT[file.type]}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-700">{file.name}</span>
            <span className="text-slate-500">{formatBytes(file.size)}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Name" hint="e.g. Resume — Backend v2">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required disabled={uploading} />
              </Field>
            </div>
            <Field label="Type">
              <Select value={type} onChange={(e) => setType(e.target.value)} disabled={uploading}>
                {Object.entries(DOCUMENT_TYPES).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {uploading && (
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-indigo-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" loading={uploading} disabled={!label.trim()}>
              Upload
            </Button>
          </div>
        </form>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </section>
  );
}
