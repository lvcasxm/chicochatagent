import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export type NoticeTone = 'neutral' | 'warning' | 'danger';

const TONES = {
  neutral: { icon: Info, box: 'bg-surface', iconClass: 'text-fg' },
  warning: { icon: TriangleAlert, box: 'bg-warning-soft', iconClass: 'text-warning' },
  danger: { icon: CircleAlert, box: 'bg-danger-soft', iconClass: 'text-danger' },
} as const;

/**
 * Aviso dentro da tela, ligado ao que aconteceu ali. Sempre com ícone e texto: a cor sozinha não
 * diz nada a quem não a distingue. Erro usa `alert`; os demais, `status`.
 */
export function Notice({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  const { icon: Icon, box, iconClass } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('type-body flex items-start gap-3 rounded-lg p-4', box, className)}
    >
      <Icon aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', iconClass)} />
      <div>{children}</div>
    </div>
  );
}
