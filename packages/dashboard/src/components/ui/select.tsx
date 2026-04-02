import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className, children, ...props }: SelectProps): React.JSX.Element {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-300',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
