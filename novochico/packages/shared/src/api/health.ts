import { z } from 'zod';

/**
 * Contrato de GET /api/health. Mesmo corpo para 200 (ok) e 503 (degradado),
 * para que o cliente e o proxy leiam o estado sem depender do status HTTP.
 */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['up', 'down']),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
