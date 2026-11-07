import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../app/auth/AuthContext';
import { AppShell } from '../../app/layouts/AppShell';
import { Button, ButtonLink } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { cx } from '../../lib/cx';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { HomeScreen } from './HomeScreen';
import { MessageList } from './MessageList';
import { useChat } from './useChat';
import { useChatLists } from './useChatLists';
import { wasSkipped } from '../../lib/feedback-skip';
import { FeedbackCard } from './FeedbackCard';
import { TicketDialog } from '../tickets/TicketDialog';

/** Tela do chat: início com atalhos, conversa em andamento e lista de conversas ao lado. */
export function ChatPage() {
  const { state, signOut } = useAuth();
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const lists = useChatLists();
  const [listOpen, setListOpen] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketCreated, setTicketCreated] = useState(false);
  // Conversa cujo pedido de avaliação foi dispensado ou respondido nesta tela.
  const [feedbackDoneFor, setFeedbackDoneFor] = useState<string | null>(null);

  const chat = useChat(conversationId ?? null, {
    onCreated: (id) => void navigate(`/c/${id}`, { replace: true }),
    onChanged: lists.refreshList,
  });

  if (state.status !== 'authenticated') return null;

  const cards = lists.bootstrap?.cards ?? [];
  const portal = lists.bootstrap?.glpiPortalUrl ?? null;
  const busy = chat.status === 'sending' || chat.status === 'streaming';
  const isHome = conversationId === undefined && chat.messages.length === 0;

  async function leave() {
    setSignOutFailed(false);
    try {
      await signOut();
    } catch {
      setSignOutFailed(true);
    }
  }

  const composer = (
    <Composer
      cards={cards}
      disabled={busy}
      autoFocus
      onSend={(text, key) => void chat.send(text, key)}
    />
  );

  async function removeConversation(id: string) {
    await lists.remove(id);
    if (id === conversationId) void navigate('/');
  }

  let content;
  if (chat.status === 'loading') {
    content = (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Carregando a conversa…</span>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-4/5" />
      </div>
    );
  } else if (chat.status === 'not_found' || chat.status === 'load_error') {
    content = (
      <ErrorState
        title={
          chat.status === 'not_found'
            ? 'Esta conversa não existe mais'
            : 'Não foi possível abrir a conversa'
        }
        description={
          chat.status === 'not_found'
            ? 'Ela pode ter sido excluída. Você pode começar uma nova.'
            : 'Verifique a sua conexão e tente de novo.'
        }
        alternative={<ButtonLink href="/">Começar uma nova conversa</ButtonLink>}
      />
    );
  } else if (isHome) {
    content = (
      <HomeScreen
        cards={cards}
        glpiPortalUrl={portal}
        composer={composer}
        disabled={busy}
        onPickCard={(card) => {
          if (card.cannedMessage) void chat.send(card.cannedMessage, card.key);
        }}
      />
    );
  } else {
    content = (
      <div className="flex min-h-[60dvh] flex-col gap-6">
        {chat.title && <h1 className="type-title-3 truncate">{chat.title}</h1>}
        <MessageList messages={chat.messages} waiting={chat.status === 'sending'} />

        {chat.failure && (
          <Notice tone="danger">
            <p>{chat.failure.message}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Button variant="outline" onClick={() => void chat.retry()} disabled={busy}>
                Tentar novamente
              </Button>
              {chat.failure.offerPortal && portal && (
                <a href={portal} target="_blank" rel="noopener noreferrer">
                  Abrir o portal de chamados
                  <span className="sr-only"> (abre em nova aba)</span>
                </a>
              )}
            </div>
          </Notice>
        )}

        {chat.triage.ticketFormUnlocked && (
          <Notice tone="neutral">
            <p className="type-label">Abertura de chamado liberada</p>
            <p className="mt-1">
              {ticketCreated
                ? 'O chamado desta conversa já foi aberto.'
                : `${chat.triage.testMode ? 'Modo de teste. ' : ''}Preencha o formulário para registrar o chamado.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {!ticketCreated && <Button onClick={() => setTicketOpen(true)}>Abrir chamado</Button>}
              {portal && !ticketCreated && (
                <a href={portal} target="_blank" rel="noopener noreferrer">
                  Prefiro abrir pelo portal
                  <span className="sr-only"> (abre em nova aba)</span>
                </a>
              )}
            </div>
          </Notice>
        )}

        {conversationId &&
          ((chat.triage.feedback === 'available' &&
            !wasSkipped(conversationId) &&
            feedbackDoneFor !== conversationId) ||
            feedbackDoneFor === `sent:${conversationId}`) && (
            <FeedbackCard
              key={conversationId}
              conversationId={conversationId}
              onSent={() => {
                setFeedbackDoneFor(`sent:${conversationId}`);
                chat.setFeedback('given');
              }}
              onSkipped={() => setFeedbackDoneFor(conversationId)}
            />
          )}

        <div className="sticky bottom-0 mt-auto bg-bg pt-2 pb-4">{composer}</div>
      </div>
    );
  }

  return (
    <AppShell
      actions={
        <Button
          variant="ghost"
          iconStart={<LogOut className="size-5" />}
          onClick={() => void leave()}
        >
          Sair
        </Button>
      }
    >
      {signOutFailed && (
        <Notice tone="danger" className="mb-6">
          Não foi possível sair agora. Tente novamente.
        </Notice>
      )}
      {lists.bootstrapFailed && (
        <Notice tone="warning" className="mb-6">
          <p>Não foi possível carregar os atalhos.</p>
          <Button variant="outline" className="mt-3" onClick={lists.retryBootstrap}>
            Tentar novamente
          </Button>
        </Notice>
      )}

      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="lg:order-first">
          <Button
            variant="outline"
            className="lg:hidden"
            aria-expanded={listOpen}
            aria-controls="lista-de-conversas"
            iconStart={listOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            onClick={() => setListOpen((open) => !open)}
          >
            Conversas
          </Button>
          <div
            id="lista-de-conversas"
            className={cx('mt-4 lg:mt-0 lg:block', !listOpen && 'hidden')}
          >
            <ConversationList
              conversations={lists.conversations}
              activeId={conversationId ?? null}
              showAdminLink={state.me.role === 'admin'}
              failed={lists.listFailed}
              onDelete={removeConversation}
            />
          </div>
        </div>
        <div className="mx-auto w-full max-w-reading min-w-0">{content}</div>
      </div>

      {/* Fora de `content`: o diálogo não pode ser desmontado e remontado junto com a conversa
          (a lista de mensagens troca de ramo ao carregar), senão ele ficaria preso aberto. */}
      {conversationId && (
        <TicketDialog
          // Recomeça o formulário a cada conversa.
          key={conversationId}
          open={ticketOpen}
          onOpenChange={setTicketOpen}
          conversationId={conversationId}
          requester={{ name: state.me.fullName, email: state.me.email }}
          lastSector={lists.bootstrap?.lastSector ?? null}
          testMode={chat.triage.testMode}
          portalUrl={portal}
          onCreated={(response) => {
            setTicketCreated(true);
            chat.appendNotice(response.message);
            // Chamado aberto: o servidor liberou a avaliação (RF-060).
            chat.setFeedback('available');
          }}
        />
      )}
    </AppShell>
  );
}
