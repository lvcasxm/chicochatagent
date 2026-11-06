import { z } from 'zod';

/**
 * Único ponto da API que lê variáveis de ambiente (regra de lint em eslint.config.js).
 * Os valores nunca aparecem em mensagens de erro: só o nome da variável e o motivo.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Valor de exemplo do .env.example; é recusado em produção. */
const SECRET_PLACEHOLDER_PREFIX = 'troque-';

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

/** Endereço público do sistema, sem caminho (a aplicação não roda em subdiretório). */
function isOriginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const http = url.protocol === 'http:' || url.protocol === 'https:';
    return http && url.pathname === '/' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const domainSchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);

const domainListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== ''),
  )
  .pipe(z.array(domainSchema).min(1));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Padrão restrito ao loopback; em contêiner, defina HOST=0.0.0.0 explicitamente.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // `true` só atrás de um proxy reverso confiável: sem isso, todo cliente parece ter o IP do proxy.
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    DATABASE_URL: z.string().refine(isPostgresUrl),
    // Usuário com direito de alterar o schema, usado só por `npm run db:migrate`. Opcional.
    DATABASE_MIGRATION_URL: z.string().refine(isPostgresUrl).optional(),

    // Endereço pelo qual o navegador acessa o sistema; define o redirect do login e o Origin aceito.
    APP_PUBLIC_URL: z.string().refine(isOriginUrl),
    // Assina o cookie temporário do login. Mínimo de 32 caracteres, aleatório.
    SESSION_SECRET: z.string().min(32),
    // Só e-mails desses domínios entram, mesmo com um login Google válido.
    ALLOWED_EMAIL_DOMAINS: domainListSchema,

    // Sem as credenciais, o login fica indisponível (a API sobe, e a rota responde 503).
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    // Apenas uma dica de conta enviada ao Google; a validação real é feita no servidor.
    GOOGLE_HOSTED_DOMAIN: domainSchema.optional(),

    // 'gemini' fala com a IA de verdade (exige GEMINI_API_KEY). 'fake' usa respostas de roteiro,
    // só para desenvolver sem chave; é recusado em produção.
    AI_PROVIDER: z.enum(['gemini', 'fake']).default('gemini'),
    // Só no servidor. Sem a chave, o chat responde que a IA está indisponível.
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_CHAT_MODEL: z.string().min(1).default('gemini-3.1-flash-lite'),
    // Cache das respostas do primeiro turno (H.7).
    CHAT_CACHE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // Portal de chamados do GLPI, oferecido quando a IA falha e na tela inicial (RF-027, RF-029).
    GLPI_PORTAL_URL: z.string().refine(isHttpUrl).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'ausente' });
    }
    if (env.GOOGLE_CLIENT_SECRET && !env.GOOGLE_CLIENT_ID) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_ID'], message: 'ausente' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.AI_PROVIDER === 'fake') {
        ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'fake em produção' });
      }
      if (env.SESSION_SECRET.startsWith(SECRET_PLACEHOLDER_PREFIX)) {
        ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'exemplo' });
      }
      if (!env.APP_PUBLIC_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_PUBLIC_URL'], message: 'precisa ser https' });
      }
    }
  });

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  hostedDomain: string | undefined;
}

/** Como o chat fala com a IA. Sem `apiKey`, o chat responde que o serviço está indisponível. */
export type AiConfig =
  { provider: 'gemini'; apiKey: string | undefined; chatModel: string } | { provider: 'fake' };

export type Config = {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  trustProxy: boolean;
  databaseUrl: string;
  databaseMigrationUrl: string | undefined;
  /** Origem pública (esquema + host + porta), sem barra final. */
  appOrigin: string;
  sessionSecret: string;
  allowedEmailDomains: string[];
  /** Nulo quando as credenciais do Google não foram configuradas. */
  google: GoogleConfig | null;
  ai: AiConfig;
  chatCacheEnabled: boolean;
  /** Portal de chamados do GLPI; nulo quando não configurado. */
  glpiPortalUrl: string | null;
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
    trustProxy: data.TRUST_PROXY,
    databaseUrl: data.DATABASE_URL,
    databaseMigrationUrl: data.DATABASE_MIGRATION_URL,
    appOrigin: new URL(data.APP_PUBLIC_URL).origin,
    sessionSecret: data.SESSION_SECRET,
    allowedEmailDomains: data.ALLOWED_EMAIL_DOMAINS,
    google:
      data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET
        ? {
            clientId: data.GOOGLE_CLIENT_ID,
            clientSecret: data.GOOGLE_CLIENT_SECRET,
            hostedDomain: data.GOOGLE_HOSTED_DOMAIN,
          }
        : null,
    ai:
      data.AI_PROVIDER === 'fake'
        ? { provider: 'fake' }
        : { provider: 'gemini', apiKey: data.GEMINI_API_KEY, chatModel: data.GEMINI_CHAT_MODEL },
    chatCacheEnabled: data.CHAT_CACHE_ENABLED,
    glpiPortalUrl: data.GLPI_PORTAL_URL ?? null,
  };
}

export function loadConfigFromProcess(): Config {
  return loadConfig(process.env);
}
