import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx';
import { useFieldControl } from './Field';
import { CONTROL_BASE } from './Input';
import { usePortalContainer } from './portal';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}

/** Lista de escolha com teclado e leitor de tela resolvidos pela primitiva do Radix. */
export function Select({
  options,
  value,
  onValueChange,
  placeholder = 'Selecione',
  name,
  disabled,
  className,
}: SelectProps) {
  const field = useFieldControl();
  const container = usePortalContainer();

  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} name={name} disabled={disabled}>
      <RadixSelect.Trigger
        {...field}
        className={cx(
          CONTROL_BASE,
          'type-body inline-flex h-12 cursor-pointer items-center justify-between gap-2 rounded-pill px-4 text-left',
          'data-[placeholder]:text-fg-muted',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown aria-hidden="true" className="size-5" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={container}>
        <RadixSelect.Content
          position="popper"
          sideOffset={8}
          className="z-50 max-h-80 w-(--radix-select-trigger-width) min-w-48 overflow-hidden rounded-lg border border-border bg-bg shadow-float"
        >
          <RadixSelect.Viewport className="p-2">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="type-body flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-tag px-3 text-fg outline-none data-[highlighted]:bg-surface-hover data-[state=checked]:font-semibold"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check aria-hidden="true" className="size-4" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
