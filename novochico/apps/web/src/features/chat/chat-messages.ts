import { SendError } from '../../lib/chat-api';

/** Textos de erro do chat, sempre em linguagem simples e sem nome de provedor (RF-026, RF-027). */
export const CHAT_ERRORS = {
  busy: 'Alta demanda no momento. Aguarde alguns segundos e tente novamente — você não perdeu a conversa.',
  rateLimited: 'Muitas solicitações. Tente novamente em alguns instantes.',
  unavailable: 'Serviço de IA indisponível no momento.',
  interrupted: 'A resposta foi interrompida. Você pode tentar de novo.',
  inProgress: 'Aguarde a resposta anterior terminar.',
  generic: 'Não foi possível enviar a mensagem. Tente novamente.',
  notFound: 'Esta conversa não existe mais.',
} as const;

export interface ChatFailure {
  message: string;
  /** Vale oferecer o portal do GLPI (a IA está fora do ar). */
  offerPortal: boolean;
}

export function describeSendError(error: unknown): ChatFailure {
  if (error instanceof SendError) {
    if (error.code === 'BUSY') return { message: CHAT_ERRORS.busy, offerPortal: false };
    if (error.status === 429) return { message: CHAT_ERRORS.rateLimited, offerPortal: false };
    if (error.code === 'AI_UNAVAILABLE' || error.status === 503) {
      return { message: CHAT_ERRORS.unavailable, offerPortal: true };
    }
    if (error.status === 409) return { message: CHAT_ERRORS.inProgress, offerPortal: false };
    if (error.status === 404) return { message: CHAT_ERRORS.notFound, offerPortal: false };
  }
  return { message: CHAT_ERRORS.generic, offerPortal: false };
}
