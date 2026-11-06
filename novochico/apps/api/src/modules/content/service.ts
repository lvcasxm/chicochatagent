import { AppError } from '../../lib/errors';
import type { ContentRepository } from './repository';

export interface PublishedInstructions {
  version: number;
  content: string;
  publishedAt: Date;
}

/** Card da tela inicial, como a interface o recebe. */
export interface HomeCard {
  key: string;
  title: string;
  description: string | null;
  icon: string | null;
  action: 'chat' | 'external_link';
  externalUrl: string | null;
  secondaryLink: { label: string; url: string } | null;
  cannedMessage: string | null;
}

export function createContentService(repository: ContentRepository) {
  return {
    /**
     * Instruções de atendimento em vigor. Sem versão publicada o agente não pode atender,
     * porque faltaria parte do prompt; isso só acontece se o seed não foi executado.
     */
    async getPublishedInstructions(): Promise<PublishedInstructions> {
      const row = await repository.findPublishedInstructions();
      if (!row?.publishedAt) {
        throw new AppError(
          'INSTRUCTIONS_NOT_PUBLISHED',
          503,
          'O atendimento está temporariamente indisponível.',
        );
      }
      return { version: row.version, content: row.content, publishedAt: row.publishedAt };
    },

    async listHomeCards(): Promise<HomeCard[]> {
      const rows = await repository.listHomeCards();
      return rows.flatMap((row) => {
        if (row.action === 'hidden') return [];
        const secondaryLink =
          row.secondaryLinkLabel && row.secondaryLinkUrl
            ? { label: row.secondaryLinkLabel, url: row.secondaryLinkUrl }
            : null;
        return [
          {
            key: row.key,
            title: row.title,
            description: row.cardDescription,
            icon: row.icon,
            action: row.action,
            externalUrl: row.externalUrl,
            secondaryLink,
            cannedMessage: row.cannedMessage,
          },
        ];
      });
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;
