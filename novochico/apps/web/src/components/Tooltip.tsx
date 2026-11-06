import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement } from 'react';
import { usePortalContainer } from './portal';

/**
 * Dica curta de um controle que só tem ícone. Ela complementa o nome acessível, não o substitui:
 * o controle precisa ter `aria-label` próprio. Aparece no foco do teclado e no hover.
 */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  const container = usePortalContainer();
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={150}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal container={container}>
          <RadixTooltip.Content
            sideOffset={8}
            className="type-small z-50 max-w-64 rounded-tag bg-fg px-3 py-2 text-bg"
          >
            {label}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
