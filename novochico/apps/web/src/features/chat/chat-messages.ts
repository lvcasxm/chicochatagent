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
  invalidImage: 'Não foi possível ler a imagem. Envie um arquivo PNG, JPEG ou WebP.',
  imageLimit:
    'Esta conversa já atingiu o limite de imagens. Descreva o restante em texto ou comece uma nova conversa.',
} as const;

export interface ChatFailure {
  message: string;
  /** Vale oferecer o portal do GLPI (a IA está fora do ar). */
  offerPortal: boolean;
  /** Repetir o mesmo envio não adianta (a imagem foi recusada): a mensagem não foi gravada. */
  rejected?: boolean;
}

export function describeSendError(error: unknown): ChatFailure {
  if (error instanceof SendError) {
    if (error.code === 'INVALID_IMAGE') {
      return { message: CHAT_ERRORS.invalidImage, offerPortal: false, rejected: true };
    }
    if (error.code === 'IMAGE_LIMIT') {
      return { message: CHAT_ERRORS.imageLimit, offerPortal: false, rejected: true };
    }
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
