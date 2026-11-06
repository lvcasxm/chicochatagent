/**
 * Versão do aviso de privacidade. Ao mudar o texto do aviso, mude esta versão: todo usuário
 * passa a precisar aceitar de novo (RF-005). O servidor guarda a versão aceita.
 */
export const PRIVACY_NOTICE_VERSION = '2026-11';

/**
 * Motivos de falha de login, repassados à tela de login em `/login?error=<código>`.
 * Nunca carregam detalhes da conta nem da falha.
 */
export const LOGIN_ERROR_CODES = [
  'domain',
  'unverified',
  'disabled',
  'cancelled',
  'expired',
  'unavailable',
  'failed',
] as const;
export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export function isLoginErrorCode(value: unknown): value is LoginErrorCode {
  return typeof value === 'string' && (LOGIN_ERROR_CODES as readonly string[]).includes(value);
}
