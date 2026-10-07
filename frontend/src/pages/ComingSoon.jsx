import Icon from '../components/Icon.jsx';

export default function ComingSoon({ module }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{module.label}</h1>
      <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <div className="rounded-full bg-indigo-50 p-3 text-indigo-600">
          <Icon name={module.icon} className="size-6" />
        </div>
        <p className="mt-4 max-w-md text-slate-600">{module.summary}</p>
        <span className="mt-4 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          Arriving in build phase {module.phase}
        </span>
      </div>
    </div>
  );
}
