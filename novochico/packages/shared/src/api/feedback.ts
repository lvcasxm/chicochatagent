import { z } from 'zod';
import { FEEDBACK_SUGGESTION_MAX_LENGTH } from '../domain/conversation';

/** Avaliação do atendimento (RF-060, RF-061): nota de 1 a 5 e sugestão opcional. */
export const submitFeedbackRequestSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  /** Texto livre; vazio é o mesmo que não enviar. */
  suggestion: z
    .string()
    .trim()
    .max(FEEDBACK_SUGGESTION_MAX_LENGTH)
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});
export type SubmitFeedbackRequest = z.input<typeof submitFeedbackRequestSchema>;

/** Rótulos das notas, para a interface não depender só do número. */
export const RATING_LABELS: Readonly<Record<number, string>> = {
  1: 'Muito ruim',
  2: 'Ruim',
  3: 'Regular',
  4: 'Bom',
  5: 'Muito bom',
};
