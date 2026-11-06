import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface EmptyStateProps {
  title: string;
  /** Diz o que fazer a seguir, em palavras de quem usa. */
  description?: string;
  /** A próxima ação possível: todo estado vazio oferece uma. */
  action?: ReactNode;
  className?: string;
}

/** Nada para mostrar ainda. Alinhado à esquerda, como o resto da interface. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section className={cx('flex max-w-reading flex-col items-start gap-4 py-12', className)}>
      <h2 className="type-title-3">{title}</h2>
      {description && <p className="type-body text-fg-muted">{description}</p>}
      {action}
    </section>
  );
}
