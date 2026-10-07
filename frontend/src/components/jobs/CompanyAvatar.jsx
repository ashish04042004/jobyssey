const PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
];

function colourFor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export default function CompanyAvatar({ company, size = 'size-11' }) {
  if (company.logoUrl) {
    return <img src={company.logoUrl} alt="" className={`${size} shrink-0 rounded-lg object-contain`} />;
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-lg text-base font-semibold ${colourFor(company.name)}`}
      aria-hidden="true"
    >
      {company.name[0]?.toUpperCase()}
    </span>
  );
}
