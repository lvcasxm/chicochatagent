import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Nome do controle. Obrigatório: um ícone sozinho não diz o que faz. */
  label: string;
  icon: ReactNode;
  /** Mostra o nome numa dica. Desligue quando o contexto já o diz. */
  tooltip?: boolean;
  /** Marca o botão como alternância ligada (ex.: tema escolhido). */
  pressed?: boolean;
}

/** Botão só de ícone: alvo de toque de 44 px (mínimo da WCAG e do design system). */
export function IconButton({
  label,
  icon,
  tooltip = true,
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-pill text-fg motion-color',
        pressed ? 'bg-accent text-accent-fg' : 'hover:bg-surface-hover',
        'disabled:cursor-not-allowed disabled:text-fg-muted',
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button;
}
