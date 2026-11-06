import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Quando existir, oferece "Tentar novamente". */
  onRetry?: () => void;
  /** Caminho alternativo quando tentar de novo não resolve (ex.: o portal de chamados). */
  alternative?: ReactNode;
  className?: string;
}

/** Algo falhou. Diz o que aconteceu, sem culpar a pessoa, e oferece uma saída (princípio I.8). */
export function ErrorState({
  title = 'Não foi possível carregar',
  description,
  onRetry,
  alternative,
  className,
}: ErrorStateProps) {
  return (
    <section
      role="alert"
      className={cx('flex max-w-reading flex-col items-start gap-4 py-12', className)}
    >
      <CircleAlert aria-hidden="true" className="size-8 text-danger" />
      <h2 className="type-title-3">{title}</h2>
      {description && <p className="type-body text-fg-muted">{description}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Tentar novamente
          </Button>
        )}
        {alternative}
      </div>
    </section>
  );
}
