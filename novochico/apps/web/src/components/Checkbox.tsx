import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useFieldControl } from './Field';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'children'
> {
  label: ReactNode;
}

/**
 * Caixa nativa de 24 px com a cor de destaque da marca: o navegador cuida do teclado, do leitor de
 * tela e do marcador. A linha inteira é o alvo de clique (mínimo de 44 px).
 */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  const field = useFieldControl();
  return (
    <label className={cx('type-body flex min-h-11 cursor-pointer items-center gap-2', className)}>
      <input
        type="checkbox"
        className="size-6 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
        {...field}
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}
