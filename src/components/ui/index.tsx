// shadcn/ui-style primitives (button, badge, card, input, textarea, label, progress)
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:bg-brand-blue-dark hover:shadow-lift',
        brand:
          'bg-brand-green text-brand-navy-deep shadow-sm hover:-translate-y-0.5 hover:shadow-glow disabled:bg-brand-border disabled:text-muted-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'border border-input bg-background shadow-sm hover:border-brand-blue/50 hover:bg-accent hover:text-accent-foreground',
        glass: 'border border-white/15 bg-white/5 text-white backdrop-blur hover:border-brand-green/50 hover:bg-white/10',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-brand-blue underline-offset-4 hover:underline',
      },
      size: { default: 'h-9 px-4 py-2', sm: 'h-8 rounded-md px-3 text-xs', lg: 'h-11 rounded-xl px-6 text-base', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = 'Button';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-brand-surface text-brand-navy/70',
      outline: 'text-foreground',
      success: 'border-transparent bg-brand-green/15 text-emerald-800',
      warning: 'border-transparent bg-amber-100 text-amber-800',
      danger: 'border-transparent bg-red-100 text-red-800',
      info: 'border-transparent bg-brand-light2/50 text-brand-blue-dark',
      violet: 'border-transparent bg-brand-purple/10 text-brand-purple',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border bg-card text-card-foreground shadow-sm shadow-brand-navy/5', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-shadow placeholder:text-muted-foreground focus-visible:border-brand-blue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/15 disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-shadow placeholder:text-muted-foreground focus-visible:border-brand-blue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/15 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const selectClass =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-shadow focus-visible:border-brand-blue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-blue/15';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-brand-surface', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn(
          'h-full rounded-full bg-[length:200%_100%] transition-[width] duration-700 ease-out',
          v >= 100
            ? 'bg-brand-green shadow-[0_0_12px_rgb(0_241_156/0.7)]'
            : 'animate-shimmer bg-[linear-gradient(90deg,#006EA7,#57ACCF,#00F19C,#57ACCF,#006EA7)]',
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
