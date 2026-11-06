import type { ReactNode } from 'react';
import { Logo, ProgramMark } from '../../components/Logo';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { cx } from '../../lib/cx';

export interface AppShellProps {
  /** Controles à direita do cabeçalho (ex.: o botão Sair). O seletor de tema já está incluído. */
  actions?: ReactNode;
  /** Largura do conteúdo: `reading` (720 px, para o chat) ou `page` (1200 px). */
  width?: 'reading' | 'page';
  children: ReactNode;
}

/**
 * Moldura das telas: cabeçalho de 80 px sobre o fundo, sem caixa nem vidro, o conteúdo numa
 * margem única de 24 px e um rodapé sem dado técnico (design system do Portal do Cidadão).
 */
export function AppShell({ actions, width = 'page', children }: AppShellProps) {
  const column = cx('mx-auto w-full px-6', width === 'reading' ? 'max-w-reading' : 'max-w-page');
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="type-label sr-only z-50 rounded-pill bg-accent px-6 py-3 text-accent-fg no-underline focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Ir para o conteúdo
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-20 w-full max-w-page items-center justify-between gap-4 px-6 py-3">
          <Logo />
          <div className="flex items-center gap-2 sm:gap-4">
            <ThemeSwitch />
            {actions}
          </div>
        </div>
      </header>
      <main
        id="conteudo"
        tabIndex={-1}
        className={cx(column, 'flex-1 py-12 outline-none md:py-16')}
      >
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-page flex-wrap items-center justify-between gap-4 px-6 py-6">
          <p className="type-small text-fg-muted">Prefeitura Municipal de Pedro Leopoldo</p>
          <ProgramMark />
        </div>
      </footer>
    </div>
  );
}
