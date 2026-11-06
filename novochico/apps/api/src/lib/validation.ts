import type { z } from 'zod';
import { AppError } from './errors';

/**
 * Valida a entrada de uma rota. A resposta é sempre genérica: dizer qual campo falhou, e por
 * que, ajudaria mais quem sonda a API do que quem a usa pela interface.
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('INVALID_INPUT', 422, 'Os dados enviados são inválidos.');
  }
  return result.data;
}
