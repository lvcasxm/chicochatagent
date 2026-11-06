import { createHash } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { OrmClient } from '../../db/client';
import { aiResponseCache } from '../../db/schema';

/**
 * Cache das respostas do primeiro turno (H.7, ADR-020). Economiza chamadas nas mensagens prontas
 * dos cards, que se repetem. Corrige dois defeitos do sistema anterior: o prazo (`expires_at`) é
 * renovado ao regravar (B-01) e a versão do prompt entra na chave, então mudar as instruções
 * invalida tudo (B-02).
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const MIN_QUESTION_LENGTH = 8;
const MAX_QUESTION_LENGTH = 600;
const MIN_ANSWER_LENGTH = 30;

/** Minúsculas, sem acento, só letras, números, espaços e `?`. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9? ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cacheKey(promptVersion: string, question: string): string {
  return createHash('sha256')
    .update(promptVersion)
    .update('\n')
    .update(normalizeQuestion(question))
    .digest('hex');
}

/** Cara de dado pessoal: e-mail, sequência longa de dígitos (matrícula, CPF) ou endereço IP. */
export function looksPersonal(text: string): boolean {
  return /@|\d{5,}|\b\d{1,3}(\.\d{1,3}){3}\b/.test(text);
}

/** Só a primeira mensagem de quem não é administrador, com tamanho de pergunta comum. */
export function isCacheableQuestion(input: {
  text: string;
  isFirstMessage: boolean;
  isAdmin: boolean;
}): boolean {
  const length = input.text.trim().length;
  return (
    input.isFirstMessage &&
    !input.isAdmin &&
    length >= MIN_QUESTION_LENGTH &&
    length <= MAX_QUESTION_LENGTH &&
    !looksPersonal(input.text)
  );
}

/** A resposta pode ser reaproveitada para outras pessoas? Escalonamento e dados pessoais, não. */
export function isCacheableAnswer(rawAnswer: string): boolean {
  return (
    rawAnswer.trim().length >= MIN_ANSWER_LENGTH &&
    !/OPEN_TICKET_FORM/i.test(rawAnswer) &&
    !looksPersonal(rawAnswer)
  );
}

export interface ResponseCache {
  /** Resposta (texto bruto da IA, com marcadores) para a pergunta, ou nulo. */
  lookup(promptVersion: string, question: string): Promise<string | null>;
  store(promptVersion: string, question: string, rawAnswer: string): Promise<void>;
}

/** Cache desligado (sem configuração ou por ambiente): nunca acerta, nunca grava. */
export const disabledCache: ResponseCache = {
  lookup: () => Promise.resolve(null),
  store: () => Promise.resolve(),
};

export function createResponseCache(deps: { orm: OrmClient; now: () => Date }): ResponseCache {
  const { orm, now } = deps;

  return {
    async lookup(promptVersion, question) {
      const key = cacheKey(promptVersion, question);
      const at = now();
      const [row] = await orm
        .update(aiResponseCache)
        .set({ hits: sql`${aiResponseCache.hits} + 1`, lastHitAt: at })
        .where(and(eq(aiResponseCache.cacheKey, key), gt(aiResponseCache.expiresAt, at)))
        .returning({ response: aiResponseCache.response });
      return row?.response ?? null;
    },

    async store(promptVersion, question, rawAnswer) {
      const at = now();
      const expiresAt = new Date(at.getTime() + TTL_MS);
      await orm
        .insert(aiResponseCache)
        .values({
          cacheKey: cacheKey(promptVersion, question),
          response: rawAnswer,
          expiresAt,
          lastHitAt: at,
        })
        .onConflictDoUpdate({
          target: aiResponseCache.cacheKey,
          // B-01: regravar renova o prazo, em vez de deixar uma linha vencida para sempre.
          set: { response: rawAnswer, expiresAt, lastHitAt: at, hits: 0 },
        });
    },
  };
}
