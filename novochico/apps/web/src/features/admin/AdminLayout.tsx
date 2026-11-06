import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AppShell } from '../../app/layouts/AppShell';
import { ButtonLink } from '../../components/Button';
import { cx } from '../../lib/cx';

const SECTIONS = [
  { to: '/admin', label: 'Visão geral', end: true },
  { to: '/admin/conversas', label: 'Conversas', end: false },
  { to: '/admin/instrucoes', label: 'Instruções do agente', end: false },
  { to: '/admin/categorias', label: 'Cards da tela inicial', end: false },
  { to: '/admin/prompt', label: 'Prompt efetivo', end: false },
  { to: '/admin/usuarios', label: 'Usuários e papéis', end: false },
  { to: '/admin/auditoria', label: 'Auditoria', end: false },
] as const;

/** Moldura da administração: navegação entre as áreas e o título da tela. */
export function AdminLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AppShell
      actions={
        <ButtonLink variant="ghost" href="/">
          Voltar ao chat
        </ButtonLink>
      }
    >
      <div className="flex flex-col gap-8">
        <nav aria-label="Administração" className="-mx-2 overflow-x-auto">
          <ul className="flex min-w-max gap-1 px-2">
            {SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink
                  to={section.to}
                  end={section.end}
                  className={({ isActive }) =>
                    cx(
                      'type-label motion-color inline-flex min-h-11 items-center rounded-pill px-4 no-underline',
                      isActive ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-surface-hover',
                    )
                  }
                >
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <h1 className="type-title-2">{title}</h1>
        {children}
      </div>
    </AppShell>
  );
}
