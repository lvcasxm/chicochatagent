import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';

/** Formato único de erro: `{ error: { code, message } }`, com `message` sempre segura. */

type ErrorBody = { error: { code: string; message: string } };

const BAD_REQUEST: ErrorBody['error'] = { code: 'BAD_REQUEST', message: 'Requisição inválida.' };
const NOT_FOUND: ErrorBody['error'] = { code: 'NOT_FOUND', message: 'Recurso não encontrado.' };

const CLIENT_ERRORS: Record<number, ErrorBody['error']> = {
  400: BAD_REQUEST,
  401: { code: 'UNAUTHENTICATED', message: 'É preciso entrar para continuar.' },
  403: { code: 'FORBIDDEN', message: 'Você não tem permissão para isso.' },
  404: NOT_FOUND,
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'O conteúdo enviado é grande demais.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Formato de conteúdo não aceito.' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Muitas solicitações. Tente novamente em instantes.' },
};

const INTERNAL: ErrorBody['error'] = {
  code: 'INTERNAL',
  message: 'Ocorreu um erro inesperado. Tente novamente.',
};

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    if (typeof statusCode === 'number') return statusCode;
  }
  return undefined;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ error: NOT_FOUND } satisfies ErrorBody);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'Erro de aplicação');
      if (error.retryAfterSeconds !== undefined) {
        void reply.header('retry-after', String(error.retryAfterSeconds));
      }
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } } satisfies ErrorBody);
    }

    // Erros do próprio Fastify (JSON inválido, corpo grande demais...): a mensagem original
    // é descartada e substituída por uma fixa.
    const status = statusOf(error);
    if (status !== undefined && status >= 400 && status < 500) {
      const mapped = CLIENT_ERRORS[status] ?? BAD_REQUEST;
      return reply.status(status).send({ error: mapped } satisfies ErrorBody);
    }

    request.log.error({ err: error }, 'Erro não tratado');
    return reply.status(500).send({ error: INTERNAL } satisfies ErrorBody);
  });
}
