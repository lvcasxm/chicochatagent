import { asc, eq } from 'drizzle-orm';
import type {
  AdminCategory,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@chicochat/shared';
import type { OrmClient } from '../../db/client';
import { categories } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { createAudit } from '../audit';

type CategoryRow = typeof categories.$inferSelect;

function toView(row: CategoryRow): AdminCategory {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    cardDescription: row.cardDescription,
    icon: row.icon,
    action: row.action,
    externalUrl: row.externalUrl,
    secondaryLinkLabel: row.secondaryLinkLabel,
    secondaryLinkUrl: row.secondaryLinkUrl,
    cannedMessage: row.cannedMessage,
    shortLabel: row.shortLabel,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

/** Só vale o que o tipo de ação usa: o resto é descartado ao gravar. */
function normalize(input: UpdateCategoryRequest) {
  const isLink = input.action === 'external_link';
  const isChat = input.action === 'chat';
  return {
    title: input.title,
    cardDescription: input.cardDescription,
    icon: input.icon,
    action: input.action,
    externalUrl: isLink ? input.externalUrl : null,
    secondaryLinkLabel: input.secondaryLinkLabel,
    secondaryLinkUrl: input.secondaryLinkUrl,
    cannedMessage: isChat ? input.cannedMessage : null,
    shortLabel: isChat ? input.shortLabel : null,
    sortOrder: input.sortOrder,
    active: input.active,
  };
}

function notFound(): AppError {
  return new AppError('CATEGORY_NOT_FOUND', 404, 'Card não encontrado.');
}

/** Cadastro dos cards da tela inicial (RF-080). Toda alteração é auditada. */
export function createCategoriesAdmin(deps: { orm: OrmClient; now: () => Date }) {
  const { orm } = deps;

  return {
    async list(): Promise<AdminCategory[]> {
      const rows = await orm
        .select()
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.key));
      return rows.map(toView);
    },

    async create(actorId: string, input: CreateCategoryRequest): Promise<AdminCategory> {
      const { key, ...fields } = input;
      return orm.transaction(async (tx) => {
        const [taken] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.key, key));
        if (taken) {
          throw new AppError(
            'CATEGORY_KEY_TAKEN',
            409,
            'Já existe um card com este identificador.',
          );
        }
        const [row] = await tx
          .insert(categories)
          .values({ key, ...normalize(fields) })
          .returning();
        if (!row) throw new Error('Card não gravado');
        await createAudit(tx).record({
          actorId,
          action: 'category.created',
          targetType: 'category',
          targetId: row.id,
          metadata: { key },
        });
        return toView(row);
      });
    },

    async update(
      actorId: string,
      id: string,
      input: UpdateCategoryRequest,
    ): Promise<AdminCategory> {
      return orm.transaction(async (tx) => {
        const [row] = await tx
          .update(categories)
          .set({ ...normalize(input), updatedAt: deps.now() })
          .where(eq(categories.id, id))
          .returning();
        if (!row) throw notFound();
        await createAudit(tx).record({
          actorId,
          action: 'category.updated',
          targetType: 'category',
          targetId: row.id,
          metadata: { key: row.key, active: row.active },
        });
        return toView(row);
      });
    },

    /** Apaga o card. Conversas antigas guardam a chave como texto e não são afetadas. */
    async remove(actorId: string, id: string): Promise<void> {
      await orm.transaction(async (tx) => {
        const [row] = await tx.delete(categories).where(eq(categories.id, id)).returning();
        if (!row) throw notFound();
        await createAudit(tx).record({
          actorId,
          action: 'category.deleted',
          targetType: 'category',
          targetId: row.id,
          metadata: { key: row.key },
        });
      });
    },
  };
}

export type CategoriesAdmin = ReturnType<typeof createCategoriesAdmin>;
