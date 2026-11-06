import { pino, stdTimeFunctions, type DestinationStream, type Logger } from 'pino';
import type { Config } from '../config';

export type { Logger };

/**
 * Campos que nunca podem aparecer em log: conteúdo de conversa, identidade e credenciais.
 * O prefixo `*.` cobre um nível de aninhamento; aninhamento mais profundo não deve ser logado.
 */
const SENSITIVE_KEYS = [
  'password',
  'email',
  'content',
  'token',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'fullName',
] as const;

export const REDACT_PATHS: string[] = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

type RequestLike = { method?: string; url?: string };

export function buildLogger(
  config: Pick<Config, 'logLevel'>,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: config.logLevel,
      timestamp: stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: {
        // Só método e caminho: a query string pode carregar token ou dado pessoal, e o
        // endereço do cliente fica com o proxy, por minimização.
        req: (req: RequestLike) => ({
          method: req.method,
          path: req.url?.split('?')[0],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
        err: pino.stdSerializers.err,
      },
    },
    destination,
  );
}
