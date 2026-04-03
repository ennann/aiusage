export function KpiCard({
  label,
  value,
  highlight = false,
  suffix,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  suffix?: string;
}) {
  return (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1.5 text-[22px] tracking-tight tabular-nums leading-none ${
          highlight ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-slate-900 dark:text-slate-100'
        }`}
      >
        {value}
        {suffix && <span className="text-slate-300 dark:text-slate-600">{suffix}</span>}
      </div>
    </div>
  );
}
