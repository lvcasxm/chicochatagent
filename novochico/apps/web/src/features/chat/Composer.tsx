import { ArrowUp, ImagePlus, X } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_BYTES,
  suggestCategoryKey,
  USER_MESSAGE_MAX_LENGTH,
  type HomeCardView,
} from '@chicochat/shared';
import { IconButton } from '../../components/IconButton';

const IMAGE_ERRORS = {
  type: 'Envie uma imagem PNG, JPEG ou WebP.',
  size: 'A imagem passa de 5 MB. Envie um arquivo menor ou um print só da parte importante.',
  read: 'Não foi possível ler a imagem. Tente outro arquivo.',
} as const;

/** Lê o arquivo como `data:` URL, já conferido o tipo e o tamanho; o servidor confere de novo. */
function readImage(file: File): Promise<string> {
  if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return Promise.reject(new Error(IMAGE_ERRORS.type));
  }
  if (file.size > IMAGE_MAX_BYTES) return Promise.reject(new Error(IMAGE_ERRORS.size));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error(IMAGE_ERRORS.read));
    reader.onerror = () => reject(new Error(IMAGE_ERRORS.read));
    reader.readAsDataURL(file);
  });
}

export interface ComposerProps {
  /** Cards do início, para dar nome à categoria sugerida. */
  cards: readonly HomeCardView[];
  disabled?: boolean;
  autoFocus?: boolean;
  /** A conversa ainda aceita imagem (o servidor limita a quantidade por conversa). */
  canAttachImage?: boolean;
  onSend: (text: string, categoryKey?: string, image?: string) => void;
}

/**
 * Campo de mensagem, o elemento mais forte da tela. Enter envia; Shift+Enter quebra a linha
 * (RF-011). A partir de 6 caracteres sugere a categoria do assunto (RF-015). Aceita uma imagem
 * por mensagem, pelo botão ou colando um print; o texto continua obrigatório.
 */
export function Composer({
  cards,
  disabled = false,
  autoFocus = false,
  canAttachImage = true,
  onSend,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [pickedKey, setPickedKey] = useState<string | undefined>();
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function attach(file: File) {
    setImageError(null);
    readImage(file).then(setImage, (error: Error) => setImageError(error.message));
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (!file || !canAttachImage) return;
    event.preventDefault();
    attach(file);
  }

  const suggestedKey = suggestCategoryKey(value);
  const suggestion = cards.find(
    (card) => card.key === suggestedKey && card.action === 'chat' && card.key !== pickedKey,
  );

  function submit(text: string, categoryKey?: string) {
    const content = text.trim();
    if (content === '' || disabled) return;
    setValue('');
    setPickedKey(undefined);
    setImage(null);
    onSend(content, categoryKey ?? pickedKey, image ?? undefined);
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
        className="flex flex-wrap items-end gap-2 rounded-lg border-2 border-border-strong bg-surface p-2 pl-4 focus-within:border-fg"
      >
        {image && (
          <div className="relative mt-2 w-full">
            <img
              src={image}
              alt="Imagem anexada"
              className="h-20 w-auto max-w-40 rounded-md border border-border object-cover"
            />
            <IconButton
              label="Remover imagem"
              icon={<X className="size-4" />}
              onClick={() => setImage(null)}
              className="absolute top-0 left-0 -translate-x-1/3 -translate-y-1/3 border border-border bg-bg"
            />
          </div>
        )}
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
          placeholder={image ? 'Conte o que aparece na imagem' : 'Descreva o seu problema'}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="type-body max-h-48 min-h-11 flex-1 resize-none self-center bg-transparent py-2.5 text-fg outline-none placeholder:text-fg-muted [field-sizing:content]"
        />
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPTED_TYPES.join(',')}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) attach(file);
            event.target.value = '';
          }}
        />
        <IconButton
          label={canAttachImage ? 'Anexar imagem' : 'Limite de imagens desta conversa atingido'}
          icon={<ImagePlus className="size-5" />}
          disabled={disabled || !canAttachImage || image !== null}
          onClick={() => fileInput.current?.click()}
        />
        <IconButton
          type="submit"
          label="Enviar mensagem"
          icon={<ArrowUp className="size-5" />}
          disabled={disabled || value.trim() === ''}
          className="bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-surface-hover"
        />
      </form>
      {imageError && (
        <p role="alert" className="type-small text-danger">
          {imageError}
        </p>
      )}
      <p className="type-small text-fg-muted">
        Sou o assistente de IA da Prefeitura, mas posso cometer erros. Verifique informações
        importantes.
      </p>
    </div>
  );
}
