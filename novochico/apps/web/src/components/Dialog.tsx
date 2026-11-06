import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './IconButton';
import { usePortalContainer } from './portal';

export interface DialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Ações, em geral um `Button` primário. */
  footer?: ReactNode;
  /**
   * Quando falso, o diálogo só fecha pela ação dele: sem botão de fechar, sem Esc e sem clique fora.
   * Para decisões que não podem ser puladas, como o aviso de privacidade.
   */
  dismissible?: boolean;
}

/**
 * Diálogo modal. Foco preso, Esc e devolução do foco vêm da primitiva do Radix; a aparência é
 * da marca: um painel de canto de 16 px, a única sombra da interface além dos menus.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
}: DialogProps) {
  const container = usePortalContainer();
  const block = (event: Event) => event.preventDefault();

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <RadixDialog.Content
          onEscapeKeyDown={dismissible ? undefined : block}
          onPointerDownOutside={dismissible ? undefined : block}
          onInteractOutside={dismissible ? undefined : block}
          // Sem descrição, suprime o vínculo que a primitiva esperaria.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[calc(100%-3rem)] max-w-dialog -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-y-auto rounded-lg bg-bg p-6 shadow-float sm:p-8"
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="type-title-3">{title}</RadixDialog.Title>
            {dismissible && (
              <RadixDialog.Close asChild>
                <IconButton
                  label="Fechar"
                  tooltip={false}
                  icon={<X className="size-5" />}
                  className="-mt-2 -mr-2"
                />
              </RadixDialog.Close>
            )}
          </div>
          {description && (
            <RadixDialog.Description asChild>
              <div className="type-body flex flex-col gap-4">{description}</div>
            </RadixDialog.Description>
          )}
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
