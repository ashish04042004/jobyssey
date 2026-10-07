import { useState } from 'react';
import { api } from '../../services/api.js';
import { Input } from '../ui.jsx';

const SUGGESTIONS = ['DSA', 'OOP', 'Operating Systems', 'DBMS', 'Computer Networks', 'System Design', 'Behavioral', 'Projects'];

export default function PrepChecklist({ applicationId, items, onChange }) {
  const [topic, setTopic] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const taken = new Set(items.map((item) => item.topic.toLowerCase()));
  const suggestions = SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase()));
  const done = items.filter((item) => item.isDone).length;

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const add = (value) =>
    run(async () => {
      const { data } = await api.applications.prep.add(applicationId, value.trim());
      onChange([...items, data]);
      setTopic('');
    });

  const toggle = (item) => {
    onChange(items.map((i) => (i.id === item.id ? { ...i, isDone: !i.isDone } : i)));
    return run(async () => {
      await api.applications.prep.update(applicationId, item.id, { isDone: !item.isDone }).catch((err) => {
        onChange(items);
        throw err;
      });
    });
  };

  const remove = (item) =>
    run(async () => {
      await api.applications.prep.remove(applicationId, item.id);
      onChange(items.filter((i) => i.id !== item.id));
    });

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={item.isDone}
                  onChange={() => toggle(item)}
                  className="size-4 rounded border-slate-300 text-emerald-600"
                  aria-label={`Mark ${item.topic} as ${item.isDone ? 'not done' : 'done'}`}
                />
                <span className={`flex-1 text-sm ${item.isDone ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{item.topic}</span>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="text-slate-400 opacity-0 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Remove ${item.topic}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (topic.trim()) add(topic);
        }}
      >
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="Add a topic and press Enter" disabled={busy} />
      </form>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
