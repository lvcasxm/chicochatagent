import { z } from 'zod';

/**
 * Único ponto da API que lê variáveis de ambiente (regra de lint em eslint.config.js).
 * Os valores nunca aparecem em mensagens de erro: só o nome da variável e o motivo.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Padrão restrito ao loopback; em contêiner, defina HOST=0.0.0.0 explicitamente.
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.string().refine(isPostgresUrl),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  databaseUrl: string;
};

export class ConfigError extends Error {
  readonly variables: string[];

  constructor(variables: string[], details: string[]) {
    super(`Configuração inválida:\n${details.map((d) => `- ${d}`).join('\n')}`);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Variável vazia equivale a ausente, para que `PORT=` use o padrão.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );

  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const names = new Set<string>();
    const details: string[] = [];
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? 'ambiente');
      if (names.has(name)) continue;
      names.add(name);
      details.push(`${name}: ${name in present ? 'valor inválido' : 'ausente'}`);
    }
    throw new ConfigError([...names], details);
  }

  const data = parsed.data;
  return {
    env: data.NODE_ENV,
    host: data.HOST,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    databaseUrl: data.DATABASE_URL,
  };
}

export function loadConfigFromProcess(): Config {
  return loadConfig(process.env);
}
