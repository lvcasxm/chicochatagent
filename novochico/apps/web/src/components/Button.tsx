import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

/**
 * Altura única de 48 px, formato de pílula (o que é clicável, no design system do Portal).
 * Primário é azul com texto #111110, nunca branco (ADR-025). O ícone final avança 4 px no hover.
 */
const BASE =
  'group inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center gap-2 rounded-pill ' +
  'type-label py-2 text-center no-underline motion-color ' +
  'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent px-8 text-accent-fg hover:bg-accent-hover ' +
    'disabled:bg-surface-hover disabled:text-fg-muted aria-disabled:bg-surface-hover aria-disabled:text-fg-muted',
  outline:
    'border-2 border-fg px-6 text-fg hover:border-accent hover:bg-accent hover:text-accent-fg ' +
    'disabled:border-border-strong disabled:text-fg-muted aria-disabled:border-border-strong aria-disabled:text-fg-muted',
  ghost: 'px-6 text-fg hover:bg-surface-hover disabled:text-fg-muted',
  danger: 'bg-danger px-8 text-on-danger hover:opacity-90 disabled:opacity-60',
};

export function buttonClass(variant: ButtonVariant = 'primary', className?: string): string {
  return cx(BASE, VARIANTS[variant], className);
}

interface CommonProps {
  variant?: ButtonVariant;
  /** Ícone no início do rótulo. */
  iconStart?: ReactNode;
  /** Ícone no fim do rótulo; avança 4 px no hover. */
  iconEnd?: ReactNode;
}

function Content({ iconStart, iconEnd, children }: CommonProps & { children: ReactNode }) {
  return (
    <>
      {iconStart}
      {children}
      {iconEnd && (
        <span
          aria-hidden="true"
          className="inline-flex transition-transform duration-150 ease-out group-hover:translate-x-1"
        >
          {iconEnd}
        </span>
      )}
    </>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, CommonProps {
  /**
   * Ação em andamento. O botão continua no foco, mas não repete o clique e avisa o leitor de tela.
   */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  iconStart,
  iconEnd,
  loading = false,
  className,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      <Content iconStart={iconStart} iconEnd={iconEnd}>
        {children}
      </Content>
    </button>
  );
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, CommonProps {}

/** Link com a aparência de botão, para navegação (o botão de verdade é para ação). */
export function ButtonLink({
  variant = 'primary',
  iconStart,
  iconEnd,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a className={buttonClass(variant, className)} {...rest}>
      <Content iconStart={iconStart} iconEnd={iconEnd}>
        {children}
      </Content>
    </a>
  );
}
