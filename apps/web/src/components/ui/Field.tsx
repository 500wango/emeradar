import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form controls. The 18 hand-written inputs each reinvented their border and
 * focus treatment. The border is `line-control` rather than `line`: a hairline
 * that is only decorative elsewhere still has to clear the 3:1 non-text
 * contrast bar when it *is* the control's only visible boundary.
 */

const controlClasses =
  'w-full rounded-sm border border-line-control bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle ' +
  'focus-visible:border-accent disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlClasses, 'pr-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses, 'min-h-[96px]', className)} {...props} />;
}

export function FieldLabel({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle', className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function FieldHint({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-xs leading-relaxed text-fg-subtle', className)}>{children}</p>;
}

export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>}
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}
