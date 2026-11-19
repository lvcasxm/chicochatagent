/** Imagem anexada pela pessoa; clicar abre o tamanho real em outra aba. */
export function AttachedImage({ src }: { src: string }) {
  const image = (
    <img
      src={src}
      alt="Imagem anexada pela pessoa"
      loading="lazy"
      className="max-h-64 w-auto max-w-[85%] rounded-lg border border-border object-contain"
    />
  );
  // Uma `data:` URL (logo depois do envio) não abre em outra aba nos navegadores atuais.
  if (src.startsWith('data:')) return image;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="contents">
      {image}
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  );
}
