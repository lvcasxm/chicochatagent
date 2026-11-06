import { useCallback, useEffect, useState } from 'react';
import type { BootstrapResponse, ConversationSummary } from '@chicochat/shared';
import { deleteConversation, fetchBootstrap, fetchConversations } from '../../lib/chat-api';

/** Cards, portal e lista de conversas: o que a moldura do chat precisa além da própria conversa. */
export function useChatLists() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listFailed, setListFailed] = useState(false);

  const loadBootstrap = useCallback(() => {
    fetchBootstrap()
      .then((result) => {
        setBootstrap(result);
        setBootstrapFailed(false);
      })
      .catch(() => setBootstrapFailed(true));
  }, []);

  const refreshList = useCallback(() => {
    fetchConversations()
      .then((list) => {
        setConversations(list);
        setListFailed(false);
      })
      .catch(() => setListFailed(true));
  }, []);

  useEffect(() => {
    loadBootstrap();
    refreshList();
  }, [loadBootstrap, refreshList]);

  const remove = useCallback(async (id: string) => {
    await deleteConversation(id);
    setConversations((current) => current.filter((c) => c.id !== id));
  }, []);

  return {
    bootstrap,
    bootstrapFailed,
    retryBootstrap: loadBootstrap,
    conversations,
    listFailed,
    refreshList,
    remove,
  };
}
