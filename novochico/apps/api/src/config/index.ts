import { z } from 'zod';
import { DEFAULT_IP_PATTERN } from '@chicochat/shared';

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

    // 'glpi' abre chamados de verdade (exige as credenciais abaixo); 'fake' simula, só em
    // desenvolvimento e recusado em produção. Sem credenciais, a abertura fica indisponível.
    GLPI_PROVIDER: z.enum(['glpi', 'fake']).default('glpi'),
    GLPI_URL: z.string().refine(isHttpUrl).optional(),
    GLPI_TOKEN_PATH: z.string().startsWith('/').default('/api.php/token'),
    GLPI_CLIENT_ID: z.string().min(1).optional(),
    GLPI_CLIENT_SECRET: z.string().min(1).optional(),
    GLPI_USERNAME: z.string().min(1).optional(),
    GLPI_PASSWORD: z.string().min(1).optional(),
    GLPI_REQUEST_TYPE_ID: z.coerce.number().int().positive().default(10),
    GLPI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
    // Formato do IP das máquinas (PEND-13). Padrão: o do sistema anterior.
    TICKET_IP_REGEX: z
      .string()
      .refine((value) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          return false;
        }
      })
      .default(DEFAULT_IP_PATTERN),
    GEMINI_SUMMARY_MODEL: z.string().min(1).default('gemini-3.1-flash-lite'),
    // Análise IA e assistente de instruções do painel (PEND-17: validar a disponibilidade).
    GEMINI_INSIGHTS_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  })
  .superRefine((env, ctx) => {
    if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'ausente' });
    }
    if (env.GOOGLE_CLIENT_SECRET && !env.GOOGLE_CLIENT_ID) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_ID'], message: 'ausente' });
    }
    const glpiVars = [
      'GLPI_URL',
      'GLPI_CLIENT_ID',
      'GLPI_CLIENT_SECRET',
      'GLPI_USERNAME',
      'GLPI_PASSWORD',
    ] as const;
    const glpiSet = glpiVars.filter((name) => env[name] !== undefined);
    // Credenciais pela metade são quase sempre um erro de digitação: a API não sobe assim.
    if (glpiSet.length > 0 && glpiSet.length < glpiVars.length) {
      for (const name of glpiVars) {
        if (env[name] === undefined) {
          ctx.addIssue({ code: 'custom', path: [name], message: 'ausente' });
        }
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.GLPI_PROVIDER === 'fake') {
        ctx.addIssue({ code: 'custom', path: ['GLPI_PROVIDER'], message: 'fake em produção' });
      }
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
  | {
      provider: 'gemini';
      apiKey: string | undefined;
      chatModel: string;
      summaryModel: string;
      insightsModel: string;
    }
  | { provider: 'fake' };

export interface GlpiConfig {
  url: string;
  tokenPath: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  requestTypeId: number;
  timeoutMs: number;
}

/** Como o sistema fala com o GLPI. `null`: sem credenciais, a abertura de chamado fica indisponível. */
export type GlpiSetting = { provider: 'glpi'; config: GlpiConfig } | { provider: 'fake' } | null;

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
  glpi: GlpiSetting;
  /** Formato aceito para o IP da máquina no chamado. */
  ticketIpRegex: string;
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
        : {
            provider: 'gemini',
            apiKey: data.GEMINI_API_KEY,
            chatModel: data.GEMINI_CHAT_MODEL,
            summaryModel: data.GEMINI_SUMMARY_MODEL,
            insightsModel: data.GEMINI_INSIGHTS_MODEL,
          },
    chatCacheEnabled: data.CHAT_CACHE_ENABLED,
    glpiPortalUrl: data.GLPI_PORTAL_URL ?? null,
    glpi:
      data.GLPI_PROVIDER === 'fake'
        ? { provider: 'fake' }
        : data.GLPI_URL &&
            data.GLPI_CLIENT_ID &&
            data.GLPI_CLIENT_SECRET &&
            data.GLPI_USERNAME &&
            data.GLPI_PASSWORD
          ? {
              provider: 'glpi',
              config: {
                url: data.GLPI_URL.replace(/\/+$/, ''),
                tokenPath: data.GLPI_TOKEN_PATH,
                clientId: data.GLPI_CLIENT_ID,
                clientSecret: data.GLPI_CLIENT_SECRET,
                username: data.GLPI_USERNAME,
                password: data.GLPI_PASSWORD,
                requestTypeId: data.GLPI_REQUEST_TYPE_ID,
                timeoutMs: data.GLPI_TIMEOUT_MS,
              },
            }
          : null,
    ticketIpRegex: data.TICKET_IP_REGEX,
  };
}

export function loadConfigFromProcess(): Config {
  return loadConfig(process.env);
}
