import { cx } from '../lib/cx';

/**
 * Bloco de carregamento sóbrio: um tom de superfície que pulsa devagar (e fica parado com "reduzir
 * movimento"). É decorativo; quem carrega deve avisar o leitor de tela com `role="status"`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-tag bg-surface-hover', className ?? 'h-4 w-full')}
    />
  );
}
