/**
 * Erro esperado, com mensagem segura para o usuário. O detalhe técnico vai em `cause`
 * e só aparece em log, nunca na resposta.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
