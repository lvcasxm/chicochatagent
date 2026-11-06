import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { ConversationSummary } from '@chicochat/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { Notice } from '../../components/Notice';
import { cx } from '../../lib/cx';
import { relativeTime } from '../../lib/time';

export interface ConversationListProps {
  conversations: readonly ConversationSummary[];
  activeId: string | null;
  failed: boolean;
  onDelete: (id: string) => Promise<void>;
}

/** Conversas do usuário, da atividade mais recente para a mais antiga (RF-016, RF-018). */
export function ConversationList({
  conversations,
  activeId,
  failed,
  onDelete,
}: ConversationListProps) {
  const [toDelete, setToDelete] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(toDelete.id);
      setToDelete(null);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <nav aria-label="Conversas" className="flex flex-col gap-4">
      <Link
        to="/"
        className="type-label motion-color inline-flex min-h-12 items-center gap-2 rounded-pill border-2 border-fg px-6 text-fg no-underline hover:border-accent hover:bg-accent hover:text-accent-fg"
      >
        <Plus aria-hidden="true" className="size-5" />
        Nova conversa
      </Link>
      <Link to="/chamados" className="type-label inline-flex min-h-11 items-center px-2">
        Meus chamados
      </Link>

      {failed && <Notice tone="warning">Não foi possível carregar a lista de conversas.</Notice>}

      {conversations.length === 0 && !failed ? (
        <p className="type-small text-fg-muted">As suas conversas aparecem aqui.</p>
      ) : (
        <ul className="flex flex-col">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId;
            const label = conversation.title ?? 'Nova conversa';
            return (
              <li key={conversation.id} className="flex items-center border-b border-border">
                <Link
                  to={`/c/${conversation.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'motion-color flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-tag px-2 py-2 no-underline',
                    active ? 'bg-accent text-accent-fg' : 'text-fg hover:bg-surface-hover',
                  )}
                >
                  <span className="type-label truncate">{label}</span>
                  <span className={cx('type-small', active ? 'text-accent-fg' : 'text-fg-muted')}>
                    {relativeTime(conversation.lastMessageAt)}
                  </span>
                </Link>
                <IconButton
                  label={`Excluir a conversa ${label}`}
                  icon={<Trash2 className="size-5" />}
                  onClick={() => {
                    setDeleteFailed(false);
                    setToDelete(conversation);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setToDelete(null);
        }}
        title="Excluir esta conversa?"
        description={
          <p>Ela deixa de aparecer na sua lista. Isto não pode ser desfeito por aqui.</p>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              Excluir
            </Button>
          </>
        }
      >
        {deleteFailed && (
          <Notice tone="danger">Não foi possível excluir agora. Tente novamente.</Notice>
        )}
      </Dialog>
    </nav>
  );
}
