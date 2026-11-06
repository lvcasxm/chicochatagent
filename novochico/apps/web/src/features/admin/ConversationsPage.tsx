import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Notice } from '../../components/Notice';
import {
  AdminApiError,
  fetchAdminConversation,
  fetchAdminConversations,
} from '../../lib/admin-api';
import { formatDateTime } from '../../lib/time';
import { AdminLayout } from './AdminLayout';
import { LoadError, LoadingBlock, outcomeLabel, Pagination, Section } from './ui';
import { useLoad } from './useLoad';

export function ConversationsPage() {
  const [draft, setDraft] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { state, reload } = useLoad(() => fetchAdminConversations(term, page), `${term}|${page}`);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setTerm(draft.trim());
  }

  return (
    <AdminLayout title="Conversas">
      <p className="type-body max-w-reading text-fg-muted">
        Abrir uma conversa fica registrado na auditoria, com o seu nome. Consulte só o que for
        necessário para o atendimento.
      </p>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3">
        <Field
          label="Buscar"
          required={false}
          hideOptionalMark
          hint="Título, nome, e-mail ou setor."
        >
          <Input
            type="search"
            value={draft}
            maxLength={100}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="outline" iconStart={<Search className="size-5" />}>
          Buscar
        </Button>
      </form>

      {state.status === 'loading' && <LoadingBlock label="Carregando as conversas…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar as conversas" onRetry={reload} />
      )}
      {state.status === 'ready' &&
        (state.data.conversations.length === 0 ? (
          <EmptyState
            title="Nenhuma conversa encontrada"
            description={term ? 'Tente outro termo de busca.' : 'Ainda não há conversas.'}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <ul className="flex flex-col border-t border-border">
              {state.data.conversations.map((conversation) => (
                <li key={conversation.id} className="border-b border-border">
                  <Link
                    to={`/admin/conversas/${conversation.id}`}
                    className="motion-color flex min-h-16 flex-col gap-1 rounded-tag px-2 py-3 no-underline hover:bg-surface-hover"
                  >
                    <span className="type-label">
                      {conversation.title ?? 'Sem título'}
                      {conversation.isTest && ' (teste)'}
                    </span>
                    <span className="type-small text-fg-muted">
                      {conversation.userName} · {conversation.userEmail}
                      {conversation.sector ? ` · ${conversation.sector}` : ''}
                    </span>
                    <span className="type-small text-fg-muted">
                      {outcomeLabel(conversation.outcome)} ·{' '}
                      {formatDateTime(conversation.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} hasMore={state.data.hasMore} onPage={setPage} />
          </div>
        ))}
    </AdminLayout>
  );
}

const ROLE_LABEL = {
  user: 'Servidor',
  assistant: 'ChicoChat+',
  notice: 'Aviso do sistema',
} as const;

/** Leitura de uma conversa. Só abrir esta tela já registra o acesso na auditoria. */
export function ConversationDetailPage() {
  const { id = '' } = useParams();
  const { state, reload } = useLoad(() => fetchAdminConversation(id), id);

  return (
    <AdminLayout title="Conversa">
      <Link to="/admin/conversas" className="type-small">
        Voltar às conversas
      </Link>
      {state.status === 'loading' && <LoadingBlock label="Carregando a conversa…" />}
      {state.status === 'error' &&
        (state.error instanceof AdminApiError && state.error.status === 404 ? (
          <EmptyState
            title="Conversa não encontrada"
            description="Ela pode ter sido apagada pela pessoa."
          />
        ) : (
          <LoadError title="Não foi possível carregar a conversa" onRetry={reload} />
        ))}
      {state.status === 'ready' && (
        <div className="flex max-w-reading flex-col gap-8">
          <Notice>Esta consulta foi registrada na auditoria.</Notice>
          <dl className="type-small grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">Título</dt>
            <dd>{state.data.title ?? 'Sem título'}</dd>
            <dt className="text-fg-muted">Servidor</dt>
            <dd>
              {state.data.userName} ({state.data.userEmail})
            </dd>
            <dt className="text-fg-muted">Setor</dt>
            <dd>{state.data.sector ?? 'Não informado'}</dd>
            <dt className="text-fg-muted">Situação</dt>
            <dd>{outcomeLabel(state.data.outcome)}</dd>
            <dt className="text-fg-muted">Iniciada em</dt>
            <dd>{formatDateTime(state.data.createdAt)}</dd>
            {state.data.isTest && (
              <>
                <dt className="text-fg-muted">Tipo</dt>
                <dd>Conversa de teste (fora das métricas)</dd>
              </>
            )}
          </dl>

          {state.data.tickets.length > 0 && (
            <Section title="Chamados">
              <ul className="type-body flex flex-col gap-1">
                {state.data.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    {ticket.glpiTicketId
                      ? `Chamado nº ${ticket.glpiTicketId}`
                      : 'Tentativa sem número'}{' '}
                    ·{' '}
                    {
                      {
                        success: 'aberto',
                        failed: 'falhou',
                        unknown: 'resultado incerto',
                        pending: 'em andamento',
                      }[ticket.status]
                    }
                    {ticket.isTest ? ' (teste)' : ''} · {formatDateTime(ticket.createdAt)}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {state.data.feedback && (
            <Section title="Avaliação">
              <p className="type-body">
                Nota {state.data.feedback.rating} de 5
                {state.data.feedback.suggestion ? `: ${state.data.feedback.suggestion}` : '.'}
              </p>
            </Section>
          )}

          <Section title="Mensagens">
            <ol className="flex flex-col gap-4">
              {state.data.messages.map((message) => (
                <li key={message.id} className="flex flex-col gap-1 rounded-lg bg-surface p-4">
                  <span className="type-small text-fg-muted">
                    {ROLE_LABEL[message.role]} · {formatDateTime(message.createdAt)}
                    {message.incomplete ? ' · resposta interrompida' : ''}
                  </span>
                  {/* Texto plano: nunca interpretado como HTML nem como markdown. */}
                  <p className="type-body break-words whitespace-pre-wrap">{message.content}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      )}
    </AdminLayout>
  );
}
