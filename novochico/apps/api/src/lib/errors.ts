/**
 * Erro esperado, com mensagem segura para o usuário. O detalhe técnico vai em `cause`
 * e só aparece em log, nunca na resposta.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  /** Quando faz sentido tentar de novo (cabeçalho `Retry-After`, em segundos). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: string,
    statusCode: number,
    message: string,
    options?: { cause?: unknown; retryAfterSeconds?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
