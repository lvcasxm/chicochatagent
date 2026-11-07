import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Arquivos com nome gerado pelo build (hash no nome) nunca mudam: podem ficar em cache. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

export type SpaFallback = (request: FastifyRequest, reply: FastifyReply) => boolean;

/**
 * Entrega da interface pela própria API, na mesma origem (ADR-041): assim os cabeçalhos de
 * segurança saem de um lugar só e a implantação é um serviço só. Os arquivos do build são
 * públicos; os dados continuam atrás do login da API.
 *
 * Devolve o tratamento de "rota desconhecida": um endereço da interface (`/admin/instrucoes`,
 * `/c/<id>`) recebe o `index.html` para o roteador do navegador decidir; `/api/...` e arquivos com
 * extensão que não existem continuam 404 em JSON.
 */
export async function registerWebAssets(
  app: FastifyInstance,
  deps: { distDir: string },
): Promise<SpaFallback> {
  // Lê o índice na partida: falta de build derruba a partida, e não cada requisição.
  const indexHtml = readFileSync(join(deps.distDir, 'index.html'));

  const sendIndex = (reply: FastifyReply) =>
    reply
      .status(200)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(indexHtml);

  await app.register(async (scope) => {
    // Rotas de arquivo estáticos são abertas; a regra de "negar por padrão" vale para a API.
    scope.addHook('onRoute', (route) => {
      route.config = { ...route.config, public: true };
    });
    // A raiz é uma pasta para o servidor de arquivos: o índice sai por rota própria.
    scope.get('/', (_request, reply) => sendIndex(reply));
    await scope.register(fastifyStatic, {
      root: deps.distDir,
      index: false,
      // Sem listagem nem arquivos ocultos.
      dotfiles: 'ignore',
      setHeaders(res, filePath) {
        res.header(
          'cache-control',
          filePath.replaceAll('\\', '/').includes('/assets/') ? IMMUTABLE : 'no-cache',
        );
      },
    });
  });

  return (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (!isRead || path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return false;
    void sendIndex(reply);
    return true;
  };
}
