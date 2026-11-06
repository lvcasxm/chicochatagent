import type { GlpiConfig } from '../../config';
import { GlpiError, type GlpiClient, type GlpiTicketInput } from './glpi';

export interface GlpiHttpOptions {
  config: GlpiConfig;
  /** Só para testes: relógio e `fetch`. */
  now?: () => number;
  fetch?: typeof fetch;
}

/** Renova o token um minuto antes de vencer (G.2). */
const TOKEN_MARGIN_MS = 60_000;

/**
 * Erros de rede que garantem que nada chegou ao GLPI (a conexão nem abriu). Qualquer outra falha
 * depois de enviar o pedido é tratada como resultado desconhecido.
 */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

function networkErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** Escapa o valor para um filtro RSQL: entre aspas, com `\` e `"` protegidos. */
export function rsqlValue(value: string): string {
  return `"${value.split('\\').join('\\\\').split('"').join('\\"')}"`;
}

/** Variações do filtro de e-mail vistas no sistema anterior, até `PEND-05` confirmar uma só. */
const REQUESTER_FILTERS = ['emails.email==', 'emails.email=ilike='] as const;

function asId(value: unknown): number | null {
  const id = typeof value === 'string' ? Number(value) : value;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/** A lista de usuários pode vir em `data`, `data.items`, `data.data` ou na raiz. */
function firstUserId(body: unknown): number | null {
  const root = body as { data?: unknown } | unknown[] | null;
  const candidates: unknown[] = [];
  if (Array.isArray(root)) candidates.push(root);
  const data = Array.isArray(root) ? undefined : root?.data;
  if (Array.isArray(data)) candidates.push(data);
  if (data && typeof data === 'object') {
    const inner = data as { items?: unknown; data?: unknown };
    candidates.push(inner.items, inner.data);
  }
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = asId((item as { id?: unknown } | null)?.id);
      if (id !== null) return id;
    }
  }
  return null;
}

/** Cliente HTTP do GLPI 11 (API de alto nível). */
export function createGlpiClient(options: GlpiHttpOptions): GlpiClient {
  const { config } = options;
  const now = options.now ?? Date.now;
  const doFetch = options.fetch ?? fetch;

  let token: { value: string; expiresAt: number } | null = null;
  /** Uma renovação por vez: chamadas simultâneas aguardam a mesma (B-08). */
  let refreshing: Promise<string> | null = null;

  async function requestToken(): Promise<string> {
    let response: Response;
    try {
      response = await doFetch(`${config.url}${config.tokenPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          username: config.username,
          password: config.password,
          scope: 'api user',
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new GlpiError('GLPI_UNAVAILABLE', { cause: error });
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new GlpiError('GLPI_AUTH', { httpStatus: response.status });
    }
    if (!response.ok) throw new GlpiError('GLPI_UNAVAILABLE', { httpStatus: response.status });

    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (typeof body?.access_token !== 'string' || body.access_token === '') {
      throw new GlpiError('GLPI_UNAVAILABLE');
    }
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 300;
    token = { value: body.access_token, expiresAt: now() + seconds * 1000 };
    return token.value;
  }

  function getToken(): Promise<string> {
    if (token && now() < token.expiresAt - TOKEN_MARGIN_MS) return Promise.resolve(token.value);
    refreshing ??= requestToken().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** Chamada autenticada. O erro de rede é tratado por quem chama, que sabe se algo foi enviado. */
  async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const bearer = await getToken();
    return doFetch(`${config.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: 'application/json',
        'GLPI-Entity-Recursive': 'true',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  }

  /** Leituras podem repetir uma vez, com token novo, se o GLPI recusar o atual (G.2). */
  async function read(path: string): Promise<Response> {
    let response: Response;
    try {
      response = await send('GET', path);
      if (response.status === 401 || response.status === 403) {
        token = null;
        response = await send('GET', path);
      }
    } catch (error) {
      if (error instanceof GlpiError) throw error;
      throw new GlpiError(isTimeout(error) ? 'GLPI_TIMEOUT' : 'GLPI_UNAVAILABLE', { cause: error });
    }
    return response;
  }

  return {
    async findRequesterId(email) {
      for (const operator of REQUESTER_FILTERS) {
        const filter = encodeURIComponent(`${operator}${rsqlValue(email)}`);
        const response = await read(`/api.php/Administration/User?filter=${filter}&limit=5`);
        if (response.status === 401 || response.status === 403) {
          throw new GlpiError('GLPI_AUTH', { httpStatus: response.status });
        }
        if (!response.ok) throw new GlpiError('GLPI_SERVER', { httpStatus: response.status });
        const id = firstUserId(await response.json().catch(() => null));
        if (id !== null) return id;
      }
      return null;
    },

    async createTicket(input: GlpiTicketInput) {
      const payload = {
        name: input.title,
        content: input.content,
        type: 1,
        request_type: { id: config.requestTypeId },
        urgency: input.urgency,
        impact: 3,
        priority: 3,
      };

      let response: Response;
      try {
        response = await send('POST', '/api.php/Assistance/Ticket', payload);
      } catch (error) {
        if (error instanceof GlpiError) throw error; // falha de token: nada foi enviado
        const code = networkErrorCode(error);
        if (code && NOT_SENT_CODES.has(code))
          throw new GlpiError('GLPI_UNAVAILABLE', { cause: error });
        // Prazo estourado ou conexão caída depois de enviar: o chamado pode existir.
        throw new GlpiError('GLPI_TIMEOUT', { cause: error });
      }

      if (response.status === 401 || response.status === 403) {
        token = null;
        throw new GlpiError('GLPI_AUTH', { httpStatus: response.status });
      }
      if (response.status === 404) throw new GlpiError('GLPI_NOT_FOUND', { httpStatus: 404 });
      if (response.status >= 500)
        throw new GlpiError('GLPI_SERVER', { httpStatus: response.status });
      if (response.status !== 200 && response.status !== 201) {
        throw new GlpiError('GLPI_REJECTED', { httpStatus: response.status });
      }

      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const id = asId(body?.id) ?? asId(body?.ID) ?? asId(body?.ticket_id);
      if (id === null) throw new GlpiError('GLPI_BAD_RESPONSE', { httpStatus: response.status });
      return { ticketId: String(id) };
    },

    async attachRequester(ticketId, requesterId) {
      let response: Response;
      try {
        response = await send(
          'POST',
          `/api.php/Assistance/Ticket/${encodeURIComponent(ticketId)}/TeamMember`,
          {
            type: 'User',
            id: requesterId,
            role: 'requester',
          },
        );
      } catch (error) {
        if (error instanceof GlpiError) throw error;
        throw new GlpiError(isTimeout(error) ? 'GLPI_TIMEOUT' : 'GLPI_UNAVAILABLE', {
          cause: error,
        });
      }
      if (!response.ok) throw new GlpiError('GLPI_SERVER', { httpStatus: response.status });
    },
  };
}
