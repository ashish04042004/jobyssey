import { useState } from 'react';

export default function TagInput({ value, onChange, suggestions = [], placeholder, max = 10 }) {
  const [draft, setDraft] = useState('');
  const has = (tag) => value.some((existing) => existing.toLowerCase() === tag.toLowerCase());

  const add = (raw) => {
    const tag = raw.trim();
    if (!tag || has(tag) || value.length >= max) return;
    onChange([...value, tag]);
  };

  const remove = (tag) => onChange(value.filter((existing) => existing !== tag));

  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
      setDraft('');
    } else if (event.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1]);
    }
  };

  const remaining = suggestions.filter((tag) => !has(tag));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-sm text-indigo-700">
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              className="text-indigo-400 hover:text-indigo-700"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            add(draft);
            setDraft('');
          }}
          placeholder={value.length ? '' : placeholder}
          className="min-w-32 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none"
        />
      </div>
      {remaining.length > 0 && value.length < max && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {remaining.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
