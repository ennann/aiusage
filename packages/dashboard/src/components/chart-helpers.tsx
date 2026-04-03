import React from 'react';

export class ChartBoundary extends React.Component<
  { children: React.ReactNode; name: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.error(`Chart [${this.props.name}]:`, err); }
  render() {
    if (this.state.hasError) {
      return <EmptyState label={`${this.props.name} failed to render`} />;
    }
    return this.props.children;
  }
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center text-[13px] text-slate-300 dark:text-slate-600">
      {label}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800 ${className}`} />;
}

export function SectionHeader({ title, stat }: { title: string; stat?: string }) {
  return (
    <div className="mb-5 flex items-baseline justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h2>
      {stat && (
        <span className="text-[14px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">{stat}</span>
      )}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5 text-[12px]">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: it.color }} />
          <span className="text-slate-500 dark:text-slate-400">{it.label}</span>
          {it.value && <span className="ml-0.5 font-medium tabular-nums text-slate-700 dark:text-slate-300">{it.value}</span>}
        </div>
      ))}
    </div>
  );
}
