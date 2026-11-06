import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import { IconButton } from './IconButton';

export type ToastTone = 'neutral' | 'warning' | 'danger';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const TONE_ICON = {
  neutral: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

const TONE_CLASS: Record<ToastTone, string> = {
  neutral: 'border-border',
  warning: 'border-warning',
  danger: 'border-danger',
};

const TONE_ICON_CLASS: Record<ToastTone, string> = {
  neutral: 'text-fg',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Tempo na tela. Erros não somem sozinhos: a pessoa precisa conseguir ler e agir. */
const AUTO_DISMISS_MS = 8000;

/** Aparência de um aviso. Separada do provedor para a página de design mostrá-la parada. */
export function ToastCard({
  title,
  description,
  tone = 'neutral',
  onDismiss,
}: ToastOptions & { onDismiss?: () => void }) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border-2 bg-bg p-4 shadow-float',
        TONE_CLASS[tone],
      )}
    >
      <Icon aria-hidden="true" className={cx('mt-0.5 size-5 shrink-0', TONE_ICON_CLASS[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="type-label">{title}</p>
        {description && <p className="type-small text-fg-muted">{description}</p>}
      </div>
      {onDismiss && (
        <IconButton
          label="Dispensar aviso"
          tooltip={false}
          icon={<X className="size-5" />}
          onClick={onDismiss}
          className="-my-2 -mr-2"
        />
      )}
    </div>
  );
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastTimer({ onExpire, children }: { onExpire: () => void; children: ReactNode }) {
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const start = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => expire.current(), AUTO_DISMISS_MS);
  }, []);
  const stop = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  // Pausa enquanto o ponteiro ou o foco estão no aviso.
  return (
    <div onMouseEnter={stop} onMouseLeave={start} onFocus={stop} onBlur={start} className="w-full">
      {children}
    </div>
  );
}

/** Avisos curtos de resultado ("Copiado", "Não foi possível enviar"). Não carregam decisão. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: (options) => {
        const id = nextId.current++;
        setItems((current) => [...current, { ...options, id }]);
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Avisos"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-3 p-4"
      >
        {items.map((item) => {
          const card = (
            <ToastCard
              title={item.title}
              description={item.description}
              tone={item.tone}
              onDismiss={() => dismiss(item.id)}
            />
          );
          return item.tone === 'danger' ? (
            <div key={item.id} className="flex w-full justify-center">
              {card}
            </div>
          ) : (
            <ToastTimer key={item.id} onExpire={() => dismiss(item.id)}>
              <div className="flex w-full justify-center">{card}</div>
            </ToastTimer>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast precisa estar dentro de ToastProvider');
  return value;
}
