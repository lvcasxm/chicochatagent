import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@chicochat/shared';

export interface RouteInfo {
  method: string;
  url: string;
  public: boolean;
  roles: readonly UserRole[] | undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Todas as rotas registradas, com o acesso de cada uma. Usado pelos testes de autorização. */
    routeCatalog: readonly RouteInfo[];
  }
}

/** Precisa ser chamado antes de registrar as rotas, para que o gancho enxergue todas. */
export function registerRouteCatalog(app: FastifyInstance): void {
  const catalog: RouteInfo[] = [];
  app.decorate('routeCatalog', catalog);

  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      // O Fastify cria um HEAD para cada GET; ele herda o acesso do GET.
      if (method === 'HEAD') continue;
      catalog.push({
        method,
        url: route.url,
        public: route.config?.public === true,
        roles: route.config?.roles,
      });
    }
  });
}
