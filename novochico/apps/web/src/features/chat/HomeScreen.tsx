import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import type { HomeCardView } from '@chicochat/shared';
import { buttonClass } from '../../components/Button';

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
 * Tela inicial: pergunta, campo de mensagem e, no máximo, poucos atalhos em pílulas, só com o
 * título. Descrição e links secundários ficam fora daqui: quem precisa de mais descreve o problema
 * no campo de mensagem. Quais atalhos aparecem é decisão da administração (cards ativos).
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
            Descreva o seu problema ou escolha um atalho.
          </p>
        </div>
      </div>

      {composer}

      {cards.length > 0 && (
        <section aria-labelledby="atalhos" className="flex flex-col gap-3">
          <h2 id="atalhos" className="type-label text-fg-muted">
            Atalhos
          </h2>
          <ul className="flex flex-wrap gap-3">
            {cards.map((card) => (
              <li key={card.key}>
                {card.action === 'chat' ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickCard(card)}
                    className={buttonClass('outline')}
                  >
                    {card.title}
                  </button>
                ) : (
                  <a
                    href={card.externalUrl ?? undefined}
                    {...EXTERNAL}
                    className={buttonClass('outline')}
                  >
                    {card.title}
                    <ExternalLink aria-hidden="true" className="size-4" />
                    <span className="sr-only">(abre em nova aba)</span>
                  </a>
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
