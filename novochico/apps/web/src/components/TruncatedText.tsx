import { useLayoutEffect, useRef, useState, type ElementType } from 'react';
import { cx } from '../lib/cx';

const ELLIPSIS = '…';

/**
 * Texto de uma linha cortado com reticências sempre coladas à última letra. O `text-overflow` do
 * CSS corta onde o espaço acabar, às vezes logo depois de um espaço ("teste …"). Aqui o corte é
 * medido no próprio elemento, e o espaço do fim sai antes das reticências.
 *
 * Quando o texto é cortado, leitores de tela recebem o texto inteiro.
 */
export function TruncatedText({
  text,
  as: Tag = 'span',
  className,
}: {
  text: string;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(text);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Por caractere visível, para não partir um emoji ao meio.
    const chars = Array.from(text);
    const candidate = (count: number) => `${chars.slice(0, count).join('').trimEnd()}${ELLIPSIS}`;
    const fits = (value: string) => {
      element.textContent = value;
      return element.scrollWidth <= element.clientWidth;
    };

    const fit = () => {
      if (fits(text)) {
        setShown(text);
        return;
      }
      // Maior prefixo que cabe com as reticências.
      let low = 0;
      let high = chars.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(candidate(middle))) low = middle;
        else high = middle - 1;
      }
      const result = candidate(low);
      element.textContent = result;
      setShown(result);
    };

    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    // A fonte da interface pode chegar depois da primeira medida.
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [text]);

  const truncated = shown !== text;
  return (
    <>
      <Tag ref={ref} aria-hidden={truncated || undefined} className={cx('truncate', className)}>
        {shown}
      </Tag>
      {truncated && <span className="sr-only">{text}</span>}
    </>
  );
}
