import type { LoginErrorCode } from '@chicochat/shared';

/**
 * Mensagens da tela de login para cada motivo de falha. Em linguagem simples, sem detalhes
 * técnicos e sem acusar o usuário. Não prometem nada que o sistema não faça.
 */
export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  domain: 'Só contas institucionais da Prefeitura podem entrar. Use a conta do seu trabalho.',
  unverified: 'O e-mail desta conta Google ainda não foi verificado.',
  disabled: 'O acesso desta conta está desativado. Entre em contato com a TI da Prefeitura.',
  cancelled: 'O login foi cancelado. Você pode tentar de novo quando quiser.',
  expired: 'A tentativa de login expirou. Tente entrar novamente.',
  unavailable: 'O login está indisponível no momento. Tente de novo em instantes.',
  failed: 'Não foi possível entrar. Tente novamente.',
};
