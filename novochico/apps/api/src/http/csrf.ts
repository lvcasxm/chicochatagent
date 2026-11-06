import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção contra requisições forjadas por outro site (CSRF). Toda escrita precisa trazer o
 * cabeçalho `Origin` igual ao endereço público do sistema. Os navegadores enviam `Origin` em
 * toda escrita e não permitem que uma página alheia o altere. A ausência do cabeçalho também
 * é recusada. Somado ao `SameSite=Lax` do cookie de sessão, fecha as duas portas.
 */
export function registerCsrfProtection(
  app: FastifyInstance,
  deps: { allowedOrigin: string },
): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (SAFE_METHODS.has(request.method)) return done();
    if (request.headers.origin === deps.allowedOrigin) return done();

    // O valor recebido não é registrado: vem do cliente e não agrega ao diagnóstico.
    request.log.warn({ hasOrigin: request.headers.origin !== undefined }, 'Origin recusado');
    done(new AppError('INVALID_ORIGIN', 403, 'Origem da requisição não permitida.'));
  });
}
