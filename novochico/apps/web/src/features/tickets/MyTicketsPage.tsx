import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { MyTicket, MyTicketsResponse } from '@chicochat/shared';
import { AppShell } from '../../app/layouts/AppShell';
import { ButtonLink } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../lib/cx';
import { fetchMyTickets } from '../../lib/my-tickets-api';
import { formatDateTime } from '../../lib/time';

const NOTICES = {
  requester_not_found:
    'Não encontramos o seu cadastro no sistema de chamados. Mostramos só os chamados abertos por aqui.',
  glpi_unavailable:
    'O sistema de chamados está indisponível agora. Mostramos só os chamados abertos por aqui, sem o andamento.',
} as const;

function TicketRow({ ticket }: { ticket: MyTicket }) {
  const [open, setOpen] = useState(false);
  const panelId = `chamado-${ticket.id}`;

  return (
    <li className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="motion-color flex min-h-16 w-full cursor-pointer items-start justify-between gap-4 rounded-tag px-2 py-4 text-left hover:bg-surface-hover"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="type-label">
            Chamado nº {ticket.id}
            {ticket.title ? `: ${ticket.title}` : ''}
          </span>
          <span className="type-small text-fg-muted">
            {[
              ticket.statusLabel,
              ticket.createdAt ? `Aberto em ${formatDateTime(ticket.createdAt)}` : null,
              ticket.updatedAt ? `Atualizado em ${formatDateTime(ticket.updatedAt)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cx(
            'mt-1 size-5 shrink-0 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div id={panelId} className="type-body flex flex-col gap-3 px-2 pb-5">
          <dl className="type-small grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">Situação</dt>
            <dd>{ticket.statusLabel ?? 'Não informada'}</dd>
            <dt className="text-fg-muted">Urgência</dt>
            <dd>{ticket.urgencyLabel ?? 'Não informada'}</dd>
          </dl>
          {/* Texto plano: nunca interpretado como HTML nem como markdown. */}
          {ticket.description ? (
            <p className="break-words whitespace-pre-wrap">{ticket.description}</p>
          ) : (
            <p className="text-fg-muted">Sem descrição disponível.</p>
          )}
        </div>
      )}
    </li>
  );
}

/** Meus chamados (RF-050 a RF-054): os do GLPI e os registrados aqui, em componente próprio. */
export function MyTicketsPage() {
  const [result, setResult] = useState<MyTicketsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    fetchMyTickets()
      .then((data) => {
        setResult(data);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  let content;
  if (failed) {
    content = (
      <ErrorState
        title="Não foi possível carregar os seus chamados"
        description="Verifique a sua conexão e tente de novo."
        onRetry={() => {
          setFailed(false);
          setResult(null);
          load();
        }}
      />
    );
  } else if (!result) {
    content = (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Carregando os seus chamados…</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-6">
        {result.notice && <Notice tone="warning">{NOTICES[result.notice]}</Notice>}
        {result.tickets.length === 0 ? (
          <EmptyState
            title="Nenhum chamado por aqui"
            description="Quando você abrir um chamado, ele aparece nesta lista."
            action={<ButtonLink href="/">Falar com o ChicoChat+</ButtonLink>}
          />
        ) : (
          <ul className="flex flex-col border-t border-border">
            {result.tickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-reading flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Link to="/" className="type-small">
            Voltar ao chat
          </Link>
          <h1 className="type-title-2">Meus chamados</h1>
        </div>
        {content}
      </div>
    </AppShell>
  );
}
