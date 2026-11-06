import { createContext, useContext } from 'react';

/**
 * Onde diálogos, listas e dicas são desenhados. Por padrão, o `body`. A página de design usa
 * isto para mostrar os dois temas lado a lado: o que sai do painel herda o tema do painel.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
