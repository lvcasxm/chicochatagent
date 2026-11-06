import { useState } from 'react';
import { RATING_LABELS, FEEDBACK_SUGGESTION_MAX_LENGTH } from '@chicochat/shared';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Notice } from '../../components/Notice';
import { Textarea } from '../../components/Input';
import { cx } from '../../lib/cx';
import { submitFeedback } from '../../lib/chat-api';
import { skipFeedback } from '../../lib/feedback-skip';

export interface FeedbackCardProps {
  conversationId: string;
  /** Avaliação enviada: a tela deixa de oferecê-la. */
  onSent: () => void;
  /** "Pular": o pedido não volta nesta conversa. */
  onSkipped: () => void;
}

/**
 * Pedido de avaliação (RF-060, RF-061): nota de 1 a 5 obrigatória, sugestão opcional e "Pular".
 * Aparece depois de um chamado aberto ou de uma resolução confirmada, uma vez por conversa.
 */
export function FeedbackCard({ conversationId, onSent, onSkipped }: FeedbackCardProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [thanks, setThanks] = useState(false);

  async function send() {
    if (rating === null) return;
    setSending(true);
    setFailed(false);
    try {
      await submitFeedback(conversationId, rating, suggestion);
      setThanks(true);
      onSent();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  if (thanks) {
    return (
      <p role="status" className="type-body text-fg-muted">
        Obrigado pela avaliação.
      </p>
    );
  }

  return (
    <section aria-labelledby="avaliacao" className="flex flex-col gap-5 rounded-lg bg-surface p-5">
      <h2 id="avaliacao" className="type-title-3">
        Como foi o atendimento?
      </h2>

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Nota de 1 a 5</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="nota"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <span
                className={cx(
                  'type-label motion-color inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border-2 px-4',
                  'border-border-strong hover:border-fg',
                  'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg',
                  'peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
                )}
              >
                {value}
                <span className="sr-only"> — {RATING_LABELS[value]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="type-small text-fg-muted" aria-hidden="true">
          1 é muito ruim e 5 é muito bom.
        </p>
      </fieldset>

      <Field label="Quer deixar uma sugestão?" required={false}>
        <Textarea
          value={suggestion}
          maxLength={FEEDBACK_SUGGESTION_MAX_LENGTH}
          onChange={(event) => setSuggestion(event.target.value)}
        />
      </Field>

      {failed && (
        <Notice tone="danger">Não foi possível enviar a avaliação. Tente novamente.</Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void send()} disabled={rating === null} loading={sending}>
          Enviar avaliação
        </Button>
        <Button
          variant="ghost"
          disabled={sending}
          onClick={() => {
            skipFeedback(conversationId);
            onSkipped();
          }}
        >
          Pular
        </Button>
      </div>
    </section>
  );
}
