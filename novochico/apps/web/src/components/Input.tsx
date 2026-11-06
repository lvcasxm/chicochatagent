import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { useFieldControl } from './Field';

/**
 * Borda de 2 px que passa de 3:1 contra o fundo (WCAG 1.4.11): a borda é o que mostra que dá para
 * digitar. No hover e no foco vai para a cor do texto; no erro, para `danger`.
 */
export const CONTROL_BASE =
  'w-full border-2 bg-transparent text-fg placeholder:text-fg-muted motion-color ' +
  'border-border-strong hover:border-fg focus-visible:border-fg ' +
  'aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface disabled:text-fg-muted';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const field = useFieldControl();
  return (
    <input
      className={cx(CONTROL_BASE, 'type-body h-12 rounded-pill px-4', className)}
      {...field}
      {...rest}
    />
  );
}

/** Várias linhas: o canto de 16 px, porque a pílula não acompanha um campo alto. */
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useFieldControl();
  return (
    <textarea
      className={cx(CONTROL_BASE, 'type-body min-h-28 resize-y rounded-lg px-4 py-3', className)}
      {...field}
      {...rest}
    />
  );
}
