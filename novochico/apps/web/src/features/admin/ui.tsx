import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { AdminApiError } from '../../lib/admin-api';
import { cx } from '../../lib/cx';

/** Mensagem do servidor para o administrador, ou o texto da tela quando não houver. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof AdminApiError && error.code !== null && error.message
    ? error.message
    : fallback;
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-2/3" />
    </div>
  );
}

export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <ErrorState
      title={title}
      description="Verifique a sua conexão e tente de novo."
      onRetry={onRetry}
    />
  );
}

/** Número em destaque com o nome embaixo; a unidade vai no rótulo, não na cor. */
export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface p-5">
      <dt className="type-small text-fg-muted">{label}</dt>
      <dd className="type-title-3">{value}</dd>
      {note && <dd className="type-caption text-fg-muted">{note}</dd>}
    </div>
  );
}

/** Barra horizontal com o valor escrito: a cor sozinha nunca carrega o dado. */
export function HBar({ label, value, max }: { label: string; value: number; max: number }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <li className="grid grid-cols-[minmax(7rem,12rem)_1fr_3rem] items-center gap-3">
      <span className="type-small truncate" title={label}>
        {label}
      </span>
      <span className="h-3 overflow-hidden rounded-xs bg-surface">
        <span
          className="block h-full rounded-xs border border-fg bg-accent"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="type-small text-right tabular-nums">{value}</span>
    </li>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('flex flex-col gap-4', className)}>
      <h2 className="type-title-3">{title}</h2>
      {children}
    </section>
  );
}

export function Pagination({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  if (page === 1 && !hasMore) return null;
  return (
    <nav aria-label="Páginas" className="flex items-center gap-4">
      <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span className="type-small text-fg-muted">Página {page}</span>
      <Button variant="outline" disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Próxima
      </Button>
    </nav>
  );
}

export const OUTCOME_LABEL = {
  resolved: 'Resolvido',
  escalated: 'Escalonado',
  no_outcome: 'Sem desfecho',
} as const;

export function outcomeLabel(outcome: keyof typeof OUTCOME_LABEL | null): string {
  return outcome ? OUTCOME_LABEL[outcome] : 'Em andamento';
}
