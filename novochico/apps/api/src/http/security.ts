import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

/**
 * Cabeçalhos de segurança (SONNET_CONTEXT, seção K). A política de conteúdo só aceita recursos da
 * própria origem e **nenhum script em linha**. O estilo em linha continua permitido porque as
 * primitivas de diálogo e lista (Radix) inserem `<style>` ao abrir; script nunca.
 *
 * O HSTS só vale quando o endereço público é https: em http (desenvolvimento) ele prenderia o
 * navegador a um https que não existe.
 */
export async function registerSecurityHeaders(
  app: FastifyInstance,
  deps: { secure: boolean },
): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(deps.secure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: deps.secure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    // A interface não incorpora recursos de outras origens: o isolamento é total.
    crossOriginEmbedderPolicy: false,
  });

  app.addHook('onSend', (request, reply, _payload, done) => {
    void reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    // Respostas da API têm dados de pessoas: nenhum proxy ou navegador deve guardá-las.
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      void reply.header('cache-control', 'no-store');
    }
    done();
  });
}
