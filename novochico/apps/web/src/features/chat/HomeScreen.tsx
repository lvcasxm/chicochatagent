import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import type { HomeCardView } from '@chicochat/shared';

export interface HomeScreenProps {
  cards: readonly HomeCardView[];
  glpiPortalUrl: string | null;
  /** O campo de mensagem, mostrado em destaque abaixo da pergunta. */
  composer: ReactNode;
  disabled: boolean;
  onPickCard: (card: HomeCardView) => void;
}

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * Tela inicial: logo, pergunta, campo de mensagem e atalhos em lista compacta com divisórias,
 * em vez de uma grade de cards (seção I.6).
 */
export function HomeScreen({
  cards,
  glpiPortalUrl,
  composer,
  disabled,
  onPickCard,
}: HomeScreenProps) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col items-start gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="type-title-2">Como posso te ajudar hoje?</h1>
          <p className="type-lead text-fg-muted">
            Sou o assistente de IA da Prefeitura Municipal de Pedro Leopoldo, especializado em TI.
            Descreva seu problema ou escolha um dos atalhos abaixo.
          </p>
        </div>
      </div>

      {composer}

      {cards.length > 0 && (
        <section aria-labelledby="atalhos" className="flex flex-col gap-2">
          <h2 id="atalhos" className="type-label text-fg-muted">
            Atalhos
          </h2>
          <ul className="flex flex-col border-t border-border">
            {cards.map((card) => (
              <li key={card.key} className="border-b border-border">
                {card.action === 'chat' ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickCard(card)}
                    className="motion-color flex min-h-16 w-full cursor-pointer flex-col items-start gap-1 rounded-tag px-2 py-3 text-left hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-fg-muted"
                  >
                    <span className="type-label">{card.title}</span>
                    {card.description && (
                      <span className="type-small text-fg-muted">{card.description}</span>
                    )}
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-x-4 px-2 py-3">
                    <a
                      href={card.externalUrl ?? undefined}
                      {...EXTERNAL}
                      className="motion-color flex min-h-11 flex-1 flex-col justify-center gap-1 text-fg no-underline hover:underline"
                    >
                      <span className="type-label inline-flex items-center gap-2">
                        {card.title}
                        <ExternalLink aria-hidden="true" className="size-4" />
                        <span className="sr-only">(abre em nova aba)</span>
                      </span>
                      {card.description && (
                        <span className="type-small text-fg-muted">{card.description}</span>
                      )}
                    </a>
                    {card.secondaryLink && (
                      <a
                        href={card.secondaryLink.url}
                        {...EXTERNAL}
                        className="type-small inline-flex min-h-11 items-center"
                      >
                        {card.secondaryLink.label}
                        <span className="sr-only"> (abre em nova aba)</span>
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {glpiPortalUrl && (
        <p className="type-small text-fg-muted">
          Já sabe o que precisa?{' '}
          <a href={glpiPortalUrl} {...EXTERNAL}>
            Sou usuário avançado
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        </p>
      )}
    </div>
  );
}
