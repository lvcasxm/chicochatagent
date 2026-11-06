import { z } from 'zod';

/** Cookie temporário do login: guarda state, nonce e PKCE entre a ida e a volta do Google. */
export const LOGIN_COOKIE_NAME = 'chico_oidc';
/** Só é enviado às rotas de login. */
export const LOGIN_COOKIE_PATH = '/api/auth';
export const LOGIN_TTL_MS = 10 * 60 * 1000;

export const pendingLoginSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
  redirectTo: z.string().min(1),
  expiresAt: z.number(),
});
export type PendingLogin = z.infer<typeof pendingLoginSchema>;

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https://');
}

/**
 * Com HTTPS, o prefixo `__Host-` faz o navegador recusar o cookie se ele tiver `Domain`,
 * se não for `Secure` ou se o caminho não for `/`: o cookie fica preso a este servidor.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-chico_session' : 'chico_session';
}
