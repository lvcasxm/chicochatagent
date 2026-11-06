import { createContext, useContext, useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from '../lib/cx';

interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

const FieldContext = createContext<FieldControlProps | null>(null);

/**
 * Propriedades de acessibilidade do controle dentro de um `Field`: o rótulo, a dica e o erro ficam
 * ligados a ele sem que a tela precise repetir `id` e `aria-describedby` (princípio I.8).
 */
export function useFieldControl(): Partial<FieldControlProps> {
  return useContext(FieldContext) ?? {};
}

export interface FieldProps {
  label: string;
  /** Instrução curta, antes de o erro aparecer. */
  hint?: string;
  /** Mensagem de erro junto do campo. */
  error?: string;
  /** Padrão: obrigatório. Campo opcional é dito no rótulo, com palavras. */
  required?: boolean;
  /** Filtros e buscas, que são óbvios, dispensam a marca "(opcional)" no rótulo. */
  hideOptionalMark?: boolean;
  /** Passe o controle (Input, Textarea, Select, Checkbox) como filho. */
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  required = true,
  hideOptionalMark = false,
  children,
  className,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };

  return (
    <FieldContext.Provider value={control}>
      <div className={cx('flex w-full max-w-field flex-col gap-2', className)}>
        <label htmlFor={id} className="type-label text-fg">
          {label}
          {!required && !hideOptionalMark && (
            <span className="font-normal text-fg-muted"> (opcional)</span>
          )}
        </label>
        {hint && (
          <p id={hintId} className="type-small text-fg-muted">
            {hint}
          </p>
        )}
        {children}
        {error && (
          <p id={errorId} className="type-small flex items-start gap-2 text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
