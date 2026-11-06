import { ArrowUp } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { suggestCategoryKey, USER_MESSAGE_MAX_LENGTH, type HomeCardView } from '@chicochat/shared';
import { IconButton } from '../../components/IconButton';

export interface ComposerProps {
  /** Cards do início, para dar nome à categoria sugerida. */
  cards: readonly HomeCardView[];
  disabled?: boolean;
  autoFocus?: boolean;
  onSend: (text: string, categoryKey?: string) => void;
}

/**
 * Campo de mensagem, o elemento mais forte da tela. Enter envia; Shift+Enter quebra a linha
 * (RF-011). A partir de 6 caracteres sugere a categoria do assunto (RF-015).
 */
export function Composer({ cards, disabled = false, autoFocus = false, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const [pickedKey, setPickedKey] = useState<string | undefined>();
  const field = useRef<HTMLTextAreaElement>(null);

  const suggestedKey = suggestCategoryKey(value);
  const suggestion = cards.find(
    (card) => card.key === suggestedKey && card.action === 'chat' && card.key !== pickedKey,
  );

  function submit(text: string, categoryKey?: string) {
    const content = text.trim();
    if (content === '' || disabled) return;
    setValue('');
    setPickedKey(undefined);
    onSend(content, categoryKey ?? pickedKey);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing`: Enter que confirma uma palavra no teclado de celular não envia.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(value);
    }
  }

  function pickSuggestion() {
    if (!suggestion) return;
    // Ao aceitar, envia a mensagem pronta do card (RF-015), em minúsculas no nome do assunto.
    submit(
      `Olá! Estou com um problema relacionado a ${suggestion.title.toLowerCase()}. Pode me ajudar?`,
      suggestion.key,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {suggestion && (
        <button
          type="button"
          onClick={pickSuggestion}
          className="type-small motion-color inline-flex min-h-11 w-fit cursor-pointer items-center rounded-pill border-2 border-border-strong px-4 hover:border-fg"
        >
          Parece sobre: <strong className="ml-1 font-semibold">{suggestion.title}</strong>
        </button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
        className="flex items-end gap-2 rounded-lg border-2 border-border-strong bg-surface p-2 pl-4 focus-within:border-fg"
      >
        <label htmlFor="composer" className="sr-only">
          Mensagem para o ChicoChat+
        </label>
        <textarea
          id="composer"
          ref={field}
          rows={1}
          value={value}
          maxLength={USER_MESSAGE_MAX_LENGTH}
          autoFocus={autoFocus}
          placeholder="Descreva o seu problema"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          className="type-body max-h-48 min-h-11 flex-1 resize-none self-center bg-transparent py-2.5 text-fg outline-none placeholder:text-fg-muted [field-sizing:content]"
        />
        <IconButton
          type="submit"
          label="Enviar mensagem"
          icon={<ArrowUp className="size-5" />}
          disabled={disabled || value.trim() === ''}
          className="bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-surface-hover"
        />
      </form>
      <p className="type-small text-fg-muted">
        O ChicoChat+ pode cometer erros. Verifique informações importantes.
      </p>
    </div>
  );
}
