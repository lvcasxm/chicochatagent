import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, TriageState } from '@chicochat/shared';
import { ApiError } from '../../lib/api';
import { createConversation, fetchConversation, sendMessage } from '../../lib/chat-api';
import { CHAT_ERRORS, describeSendError, type ChatFailure } from './chat-messages';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  content: string;
  incomplete: boolean;
}

export type ChatStatus = 'loading' | 'ready' | 'sending' | 'streaming' | 'not_found' | 'load_error';

const EMPTY_TRIAGE: TriageState = {
  resolutionAttempts: 0,
  issuePersists: null,
  ticketFormUnlocked: false,
  testMode: false,
  resolved: false,
};

export interface UseChatOptions {
  /** A conversa nasceu nesta tela: a rota passa a apontar para ela, sem recarregar. */
  onCreated: (conversationId: string) => void;
  /** Algo mudou na lista (nova conversa, título): quem mostra a lista deve atualizá-la. */
  onChanged: () => void;
}

/**
 * Estado de uma conversa na tela: histórico vindo do servidor, envio com resposta em stream e
 * erros. O cliente só envia texto; o servidor decide papéis, triagem e liberação do chamado.
 */
export function useChat(conversationId: string | null, options: UseChatOptions) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [triage, setTriage] = useState<TriageState>(EMPTY_TRIAGE);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>(conversationId ? 'loading' : 'ready');
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [lastText, setLastText] = useState<string | null>(null);

  const idRef = useRef(conversationId);
  // Conversa criada nesta tela: já está na tela, não precisa ser buscada ao a rota apontar para ela.
  const [createdHere, setCreatedHere] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
    idRef.current = conversationId;
  });

  // Troca de conversa: ajusta o estado durante a renderização, sem passar por um efeito.
  const [shownId, setShownId] = useState(conversationId);
  if (conversationId !== shownId) {
    setShownId(conversationId);
    setFailure(null);
    if (conversationId === null) {
      setMessages([]);
      setTriage(EMPTY_TRIAGE);
      setTitle(null);
      setLastText(null);
      setCreatedHere(null);
      setStatus('ready');
    } else if (createdHere !== conversationId) {
      setStatus('loading');
    }
  }

  // Carrega o histórico ao abrir uma conversa existente (RF-017).
  useEffect(() => {
    if (conversationId === null || createdHere === conversationId) return undefined;

    const controller = new AbortController();
    fetchConversation(conversationId)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setMessages(
          detail.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            incomplete: m.incomplete,
          })),
        );
        setTriage(detail.triage);
        setTitle(detail.title);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus(error instanceof ApiError && error.status === 404 ? 'not_found' : 'load_error');
      });
    return () => controller.abort();
  }, [conversationId, createdHere]);

  // Sair da tela cancela a resposta em andamento.
  useEffect(() => () => abortRef.current?.abort(), []);

  const applyEvent = useCallback((event: ChatEvent, assistantLocalId: string) => {
    switch (event.event) {
      case 'delta':
        setStatus('streaming');
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantLocalId ? { ...m, content: m.content + event.data.text } : m,
          ),
        );
        break;
      case 'triage':
        setTriage((t) => ({
          ...t,
          resolutionAttempts: event.data.resolutionAttempts,
          issuePersists: event.data.issuePersists,
        }));
        break;
      case 'ticket_form':
        setTriage((t) => ({ ...t, ticketFormUnlocked: true, testMode: event.data.testMode }));
        break;
      case 'feedback_prompt':
        setTriage((t) => ({ ...t, resolved: true }));
        break;
      case 'done':
        setTitle(event.data.title);
        break;
      case 'error':
        setMessages((current) =>
          current.map((m) => (m.id === assistantLocalId ? { ...m, incomplete: true } : m)),
        );
        setFailure({ message: event.data.message || CHAT_ERRORS.interrupted, offerPortal: false });
        break;
      case 'meta':
        break;
    }
  }, []);

  const send = useCallback(
    async (text: string, categoryKey?: string): Promise<void> => {
      const content = text.trim();
      if (content === '') return;

      setFailure(null);
      setLastText(content);
      setStatus('sending');
      const controller = new AbortController();
      abortRef.current = controller;

      const userLocalId = `local-user-${crypto.randomUUID()}`;
      const assistantLocalId = `local-assistant-${crypto.randomUUID()}`;
      setMessages((current) => [
        ...current,
        { id: userLocalId, role: 'user', content, incomplete: false },
        { id: assistantLocalId, role: 'assistant', content: '', incomplete: false },
      ]);

      try {
        let id = idRef.current;
        if (id === null) {
          const created = await createConversation(categoryKey);
          id = created.id;
          idRef.current = id;
          setCreatedHere(id);
          optionsRef.current.onCreated(id);
        }
        for await (const event of sendMessage(id, content, controller.signal)) {
          applyEvent(event, assistantLocalId);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        // Sem resposta: tira o balão vazio da IA. A mensagem da pessoa fica, e dá para repetir.
        setMessages((current) => current.filter((m) => m.id !== assistantLocalId));
        setFailure(describeSendError(error));
      } finally {
        if (!controller.signal.aborted) {
          setMessages((current) =>
            current.filter((m) => !(m.id === assistantLocalId && m.content === '')),
          );
          setStatus('ready');
          optionsRef.current.onChanged();
        }
      }
    },
    [applyEvent],
  );

  /** Repete o último envio (RF-028). O servidor reaproveita a mensagem já gravada. */
  const retry = useCallback(() => {
    if (lastText === null) return Promise.resolve();
    // Remove da tela a cópia local da última mensagem; o envio a coloca de novo.
    setMessages((current) => {
      const index = current.findLastIndex((m) => m.role === 'user' && m.content === lastText);
      return index >= 0 ? current.filter((_, i) => i !== index) : current;
    });
    return send(lastText);
  }, [lastText, send]);

  /** Registra na tela um aviso do sistema (ex.: chamado aberto), igual ao que o servidor gravou. */
  const appendNotice = useCallback((content: string) => {
    setMessages((current) => [
      ...current,
      { id: `local-notice-${crypto.randomUUID()}`, role: 'notice', content, incomplete: false },
    ]);
  }, []);

  return { messages, triage, title, status, failure, send, retry, appendNotice };
}
