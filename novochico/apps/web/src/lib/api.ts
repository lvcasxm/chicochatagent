import { healthResponseSchema, type HealthResponse } from '@chicochat/shared';

/**
 * Consulta GET /api/health. A API devolve o mesmo corpo em 200 e 503, então qualquer
 * outra resposta (404 do proxy, HTML de erro) cai na validação do contrato e vira erro.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    signal,
    headers: { accept: 'application/json' },
  });
  const body: unknown = await response.json();
  return healthResponseSchema.parse(body);
}
