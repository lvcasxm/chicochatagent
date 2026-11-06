import { meResponseSchema, type MeResponse } from '@chicochat/shared';

/** Falha de uma chamada à API. Guarda só o status: a mensagem para o usuário é da interface. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`A API respondeu com o status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Chamada à API do próprio sistema. O cookie de sessão é HttpOnly e segue sozinho na mesma
 * origem; o navegador também envia o `Origin` que a API exige nas escritas.
 */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });
}

/** O usuário logado, ou `null` se não houver sessão válida. */
export async function fetchMe(signal?: AbortSignal): Promise<MeResponse | null> {
  const response = await call('/api/me', signal ? { signal } : {});
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(response.status);
  return meResponseSchema.parse(await response.json());
}

/** Registra no servidor que o usuário aceitou esta versão do aviso de privacidade. */
export async function acceptPrivacy(version: string): Promise<void> {
  const response = await call('/api/me/privacy-ack', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
  if (!response.ok) throw new ApiError(response.status);
}

/** Encerra a sessão. Se ela já tinha acabado (401), o objetivo foi atingido. */
export async function logout(): Promise<void> {
  const response = await call('/api/auth/logout', { method: 'POST' });
  if (!response.ok && response.status !== 401) throw new ApiError(response.status);
}

/** Endereço que inicia o login com o Google; o servidor valida o destino pedido. */
export function googleLoginUrl(redirectTo: string): string {
  return `/api/auth/google?redirect=${encodeURIComponent(redirectTo)}`;
}
