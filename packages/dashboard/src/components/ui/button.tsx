import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex h-10 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'border-slate-200 bg-white text-slate-950 hover:bg-slate-50',
        primary: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700',
        ghost: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
