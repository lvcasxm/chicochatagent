import { useEffect, useRef } from 'react';
import { Markdown } from '../../components/Markdown';
import { Notice } from '../../components/Notice';
import { cx } from '../../lib/cx';
import type { UiMessage } from './useChat';

/**
 * Conversa: texto da pessoa em balão azul à direita; texto da IA direto sobre o fundo, em
 * Markdown (nunca HTML), para a leitura fluir (seção I.6).
 */
export function MessageList({
  messages,
  waiting,
}: {
  messages: readonly UiMessage[];
  /** Esperando o primeiro trecho da resposta. */
  waiting: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);

  // Acompanha a resposta que chega, sem brigar com quem rolou para cima para reler.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, waiting]);

  return (
    <div className="flex flex-col gap-6" role="log" aria-label="Conversa" aria-live="polite">
      {messages.map((message) => {
        if (message.role === 'user') {
          return (
            <div key={message.id} className="flex justify-end">
              <p className="type-body max-w-[85%] rounded-lg bg-accent px-4 py-3 break-words whitespace-pre-wrap text-accent-fg">
                {message.content}
              </p>
            </div>
          );
        }
        if (message.role === 'notice') {
          return (
            <Notice key={message.id} tone="neutral">
              {message.content}
            </Notice>
          );
        }
        if (message.content === '') return null;
        return (
          <div key={message.id} className={cx(message.incomplete && 'opacity-80')}>
            <Markdown>{message.content}</Markdown>
            {message.incomplete && (
              <p className="type-small mt-2 text-fg-muted">Resposta incompleta.</p>
            )}
          </div>
        );
      })}
      {waiting && (
        <p role="status" className="type-small text-fg-muted">
          <span className="sr-only">O ChicoChat+ está escrevendo… </span>
          <span aria-hidden="true">Escrevendo…</span>
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
