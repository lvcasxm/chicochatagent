import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../lib/cx';

/**
 * Texto da IA e do GLPI é dado não confiável (ADR-030 e RF-013): só Markdown, nunca HTML.
 * Elementos fora da lista são descartados (o texto fica), HTML bruto é ignorado, imagens não
 * carregam (evitam requisição a terceiros) e só `http`, `https` e `mailto` viram link.
 */
const ALLOWED_ELEMENTS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'ul',
  'ol',
  'li',
  'a',
  'code',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
];

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Aceita só endereços absolutos com protocolo permitido; o resto vira texto sem link. */
export function safeUrl(url: string): string | null {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

const components: Components = {
  a({ href, children }) {
    if (!href) return <span>{children}</span>;
    if (href.toLowerCase().startsWith('mailto:')) return <a href={href}>{children}</a>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    );
  },
  // Títulos dentro de uma resposta são subtítulos da conversa, nunca o título da página.
  h1: ({ children }) => <h3 className="type-title-3">{children}</h3>,
  h2: ({ children }) => <h3 className="type-title-3">{children}</h3>,
  h3: ({ children }) => <h4 className="type-label">{children}</h4>,
  h4: ({ children }) => <h4 className="type-label">{children}</h4>,
  ul: ({ children }) => <ul className="list-disc pl-6 marker:text-fg-muted">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 marker:text-fg-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-1 [&>ol]:mt-2 [&>p]:mt-0 [&>ul]:mt-2">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-strong pl-4 text-fg-muted">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded-xs bg-surface px-1 font-mono text-[0.9em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre
      tabIndex={0}
      className="type-small overflow-x-auto rounded-tag bg-surface p-4 [&_code]:bg-transparent [&_code]:p-0"
    >
      {children}
    </pre>
  ),
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactNode {
  return (
    <div className={cx('type-body flex flex-col gap-4 break-words [&>*]:m-0', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        skipHtml
        urlTransform={safeUrl}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
