import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { TranscriptResponse } from '@chicochat/shared';
import { AppShell } from '../../app/layouts/AppShell';
import { ButtonLink } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { ApiError } from '../../lib/api';
import { fetchTranscript } from '../../lib/my-tickets-api';
import { formatDateTime } from '../../lib/time';

/** Quem fala em cada mensagem (RF-058): a pessoa é "Servidor", sem nome. */
const SPEAKER = { user: 'Servidor', assistant: 'ChicoChat+' } as const;

type State =
  | { status: 'loading' }
  | { status: 'ready'; transcript: TranscriptResponse }
  | { status: 'not_found' }
  | { status: 'error' };

/**
 * Transcrição do chamado (RF-057, RF-058), em `/conversa/:token`. Quem não entrou é levado ao
 * login e volta para cá; quem não pode ver recebe a mesma tela de uma conversa que não existe.
 * Todo o conteúdo é texto: nada do que foi dito é interpretado como HTML ou markdown.
 */
export function TranscriptPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchTranscript(token)
      .then((transcript) => {
        if (!controller.signal.aborted) setState({ status: 'ready', transcript });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: error instanceof ApiError && error.status === 404 ? 'not_found' : 'error',
        });
      });
    return () => controller.abort();
  }, [token]);

  let content;
  if (state.status === 'loading') {
    content = (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Carregando a conversa…</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (state.status === 'not_found') {
    content = (
      <ErrorState
        title="Conversa não encontrada"
        description="O endereço pode estar incompleto, ou você não tem permissão para ver esta conversa."
        alternative={<ButtonLink href="/">Ir para o início</ButtonLink>}
      />
    );
  } else if (state.status === 'error') {
    content = (
      <ErrorState
        title="Não foi possível carregar a conversa"
        description="Verifique a sua conexão e tente de novo."
        onRetry={() => {
          setState({ status: 'loading' });
          fetchTranscript(token)
            .then((transcript) => setState({ status: 'ready', transcript }))
            .catch((error: unknown) =>
              setState({
                status: error instanceof ApiError && error.status === 404 ? 'not_found' : 'error',
              }),
            );
        }}
      />
    );
  } else {
    const { transcript } = state;
    content = (
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <h1 className="type-title-2">
            {transcript.ticketId ? `Chamado nº ${transcript.ticketId}` : 'Conversa do chamado'}
          </h1>
          <dl className="type-body grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            {transcript.title && (
              <>
                <dt className="text-fg-muted">Título</dt>
                <dd>{transcript.title}</dd>
              </>
            )}
            {transcript.requesterName && (
              <>
                <dt className="text-fg-muted">Solicitante</dt>
                <dd>{transcript.requesterName}</dd>
              </>
            )}
            {transcript.sector && (
              <>
                <dt className="text-fg-muted">Setor</dt>
                <dd>{transcript.sector}</dd>
              </>
            )}
            <dt className="text-fg-muted">Aberto em</dt>
            <dd>{formatDateTime(transcript.openedAt)}</dd>
          </dl>
        </header>

        {transcript.summary && (
          <section aria-labelledby="resumo" className="flex flex-col gap-3">
            <h2 id="resumo" className="type-title-3">
              Resumo do chamado
            </h2>
            <p className="type-body break-words whitespace-pre-wrap">{transcript.summary}</p>
          </section>
        )}

        <section aria-labelledby="conversa" className="flex flex-col gap-4">
          <h2 id="conversa" className="type-title-3">
            Conversa
          </h2>
          <p className="type-small text-fg-muted">
            Retrato da conversa no momento em que o chamado foi aberto.
          </p>
          <ol className="flex flex-col border-t border-border">
            {transcript.messages.map((message, index) => (
              <li key={index} className="flex flex-col gap-1 border-b border-border py-4">
                <p className="type-label">
                  {SPEAKER[message.role]}
                  <span className="type-small ml-3 font-normal text-fg-muted">
                    {formatDateTime(message.at)}
                  </span>
                </p>
                <p className="type-body break-words whitespace-pre-wrap">{message.content}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-reading flex-col gap-8">
        <Link to="/" className="type-small">
          Ir para o início
        </Link>
        {content}
      </div>
    </AppShell>
  );
}
