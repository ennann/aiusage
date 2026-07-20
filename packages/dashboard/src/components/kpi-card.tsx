import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { toggleCurrency, useCurrencyStore } from '../hooks/use-cny-rate';

export function KpiCard({
  label,
  value,
  highlight = false,
  suffix,
  delta,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  suffix?: string;
  delta?: string;
}) {
  return (
    <div className="relative min-h-[86px] px-4 py-4 pb-7 sm:px-5 sm:py-5 sm:pb-7">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1.5 text-[22px] tracking-tight tabular-nums leading-none ${
          highlight ? 'font-bold text-emerald-600 dark:text-emerald-500' : 'font-semibold text-slate-900 dark:text-slate-400'
        }`}
      >
        {value}
        {suffix && <span className="text-slate-300 dark:text-slate-600">{suffix}</span>}
      </div>
      {delta && (
        <div className="absolute bottom-3 right-4 text-[12px] font-medium tabular-nums text-slate-300 dark:text-slate-600 sm:right-5">
          {delta}
        </div>
      )}
    </div>
  );
}

export function CostKpiCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const { showCny, rate } = useCurrencyStore();

  return (
    <div
      className="relative min-h-[86px] px-4 py-4 pb-7 sm:px-5 sm:py-5 sm:pb-7"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[22px] tracking-tight tabular-nums leading-none font-bold text-emerald-600 dark:text-emerald-500">
          {value}
        </span>
        {rate && (
          <button
            onClick={toggleCurrency}
            className={`p-0.5 rounded transition-opacity cursor-pointer text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400 ${
              hovered ? 'opacity-100' : 'opacity-0'
            }`}
            title={showCny ? 'Switch to USD' : 'Switch to CNY'}
          >
            <ArrowRightLeft size={12} />
          </button>
        )}
      </div>
      {delta && (
        <div className="absolute bottom-3 right-4 text-[12px] font-medium tabular-nums text-slate-300 dark:text-slate-600 sm:right-5">
          {delta}
        </div>
      )}
    </div>
  );
}
