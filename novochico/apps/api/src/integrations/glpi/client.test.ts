import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GlpiConfig } from '../../config';
import { createGlpiClient, rsqlValue } from './client';
import { createFakeGlpi } from './fake';
import { GlpiError } from './glpi';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Handler = (req: Recorded, res: ServerResponse) => void;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

describe('cliente HTTP do GLPI (contra um servidor falso)', () => {
  let server: Server;
  let baseUrl: string;
  const requests: Recorded[] = [];
  let handler: Handler;
  let tokenCalls: number;
  let tokenStatus = 200;
  let clock = 1_000_000;

  const config = (overrides: Partial<GlpiConfig> = {}): GlpiConfig => ({
    url: baseUrl,
    tokenPath: '/api.php/token',
    clientId: 'client-fake',
    clientSecret: 'segredo-fake',
    username: 'servico',
    password: 'senha-fake',
    requestTypeId: 10,
    timeoutMs: 3000,
    ...overrides,
  });
  const client = (overrides: Partial<GlpiConfig> = {}) =>
    createGlpiClient({ config: config(overrides), now: () => clock });

  beforeEach(async () => {
    requests.length = 0;
    tokenCalls = 0;
    tokenStatus = 200;
    clock = 1_000_000;
    handler = (_req, res) => json(res, 404, {});
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const recorded: Recorded = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        };
        requests.push(recorded);
        if (recorded.url === '/api.php/token') {
          tokenCalls += 1;
          if (tokenStatus !== 200) return json(res, tokenStatus, { error: 'x' });
          return json(res, 200, { access_token: `token-${tokenCalls}`, expires_in: 300 });
        }
        handler(recorded, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const apiCalls = () => requests.filter((r) => r.url !== '/api.php/token');
  const failure = async (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error as GlpiError,
    );

  describe('autenticação', () => {
    it('pede o token por senha, em formulário, com o escopo certo', async () => {
      handler = (_r, res) => json(res, 200, { data: [{ id: 5 }] });
      await client().findRequesterId('a@b.test');
      const token = requests[0];
      expect(token?.method).toBe('POST');
      expect(token?.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(Object.fromEntries(new URLSearchParams(token?.body))).toEqual({
        grant_type: 'password',
        client_id: 'client-fake',
        client_secret: 'segredo-fake',
        username: 'servico',
        password: 'senha-fake',
        scope: 'api user',
      });
    });

    it('guarda o token e renova um minuto antes de vencer', async () => {
      handler = (_r, res) => json(res, 200, { data: [{ id: 5 }] });
      const glpi = client();
      await glpi.findRequesterId('a@b.test');
      await glpi.findRequesterId('a@b.test');
      expect(tokenCalls).toBe(1);

      clock += 239_000; // 300 s de validade: ainda dentro da margem de 60 s
      await glpi.findRequesterId('a@b.test');
      expect(tokenCalls).toBe(1);

      clock += 2_000; // passou de 240 s
      await glpi.findRequesterId('a@b.test');
      expect(tokenCalls).toBe(2);
      expect(apiCalls().at(-1)?.headers.authorization).toBe('Bearer token-2');
    });

    it('chamadas simultâneas esperam a mesma renovação (B-08)', async () => {
      handler = (_r, res) => json(res, 200, { data: [{ id: 5 }] });
      const glpi = client();
      await Promise.all(Array.from({ length: 8 }, () => glpi.findRequesterId('a@b.test')));
      expect(tokenCalls).toBe(1);
    });

    it.each([
      [400, 'GLPI_AUTH'],
      [401, 'GLPI_AUTH'],
      [403, 'GLPI_AUTH'],
      [500, 'GLPI_UNAVAILABLE'],
      [503, 'GLPI_UNAVAILABLE'],
    ])('token com HTTP %i vira %s, sem enviar nada ao chamado', async (status, code) => {
      tokenStatus = status;
      const error = await failure(client().createTicket({ title: 't', content: 'c', urgency: 3 }));
      expect(error).toBeInstanceOf(GlpiError);
      expect(error?.code).toBe(code);
      expect(error?.outcomeUnknown).toBe(false);
      expect(apiCalls()).toHaveLength(0);
    });

    it('a mensagem do erro não vaza credenciais', async () => {
      tokenStatus = 401;
      const error = await failure(client().findRequesterId('a@b.test'));
      expect(error?.message).not.toMatch(/segredo-fake|senha-fake|client-fake/);
    });
  });

  describe('busca do solicitante', () => {
    it('filtra pelo e-mail, com escape, e usa o primeiro id válido', async () => {
      handler = (_r, res) =>
        json(res, 200, { data: [{ id: 'x' }, { id: 0 }, { id: '42' }, { id: 9 }] });
      expect(await client().findRequesterId('fulano@prefeitura.example.test')).toBe(42);
      const call = apiCalls()[0];
      expect(call?.method).toBe('GET');
      expect(call?.headers['glpi-entity-recursive']).toBe('true');
      const url = new URL(call?.url ?? '', 'http://x');
      expect(url.pathname).toBe('/api.php/Administration/User');
      expect(url.searchParams.get('filter')).toBe('emails.email=="fulano@prefeitura.example.test"');
      expect(url.searchParams.get('limit')).toBe('5');
    });

    it('protege aspas e barras no valor do filtro', () => {
      expect(rsqlValue('a"b')).toBe('"a\\"b"');
      expect(rsqlValue('a\\b')).toBe('"a\\\\b"');
      expect(rsqlValue('x";id==1;name=="')).toBe('"x\\";id==1;name==\\""');
    });

    it.each([
      ['data', { data: [{ id: 7 }] }],
      ['data.items', { data: { items: [{ id: 7 }] } }],
      ['data.data', { data: { data: [{ id: 7 }] } }],
      ['lista na raiz', [{ id: 7 }]],
    ])('aceita a lista em %s', async (_name, body) => {
      handler = (_r, res) => json(res, 200, body);
      expect(await client().findRequesterId('a@b.test')).toBe(7);
    });

    it('sem resultado devolve nulo, depois de tentar a variação do filtro', async () => {
      handler = (_r, res) => json(res, 200, { data: [] });
      expect(await client().findRequesterId('a@b.test')).toBeNull();
      expect(apiCalls()).toHaveLength(2);
      expect(decodeURIComponent(apiCalls()[1]?.url ?? '')).toContain('emails.email=ilike=');
    });

    it('401 na leitura renova o token e tenta uma única vez', async () => {
      let calls = 0;
      handler = (_r, res) =>
        ++calls === 1 ? json(res, 401, {}) : json(res, 200, { data: [{ id: 3 }] });
      expect(await client().findRequesterId('a@b.test')).toBe(3);
      expect(tokenCalls).toBe(2);
    });

    it('401 persistente vira GLPI_AUTH, sem laço', async () => {
      handler = (_r, res) => json(res, 401, {});
      const error = await failure(client().findRequesterId('a@b.test'));
      expect(error?.code).toBe('GLPI_AUTH');
      expect(apiCalls()).toHaveLength(2);
    });

    it('500 e rede fora do ar viram erros próprios', async () => {
      handler = (_r, res) => json(res, 500, {});
      expect((await failure(client().findRequesterId('a@b.test')))?.code).toBe('GLPI_SERVER');
      handler = () => undefined; // nunca responde
      expect((await failure(client({ timeoutMs: 150 }).findRequesterId('a@b.test')))?.code).toBe(
        'GLPI_TIMEOUT',
      );
    });
  });

  describe('criação do chamado', () => {
    const input = { title: 'Impressora do RH offline', content: '**corpo**', urgency: 4 };

    it('envia o corpo exato da seção G.4, com a entidade recursiva', async () => {
      handler = (_r, res) => json(res, 201, { id: 321 });
      expect(await client().createTicket(input)).toEqual({ ticketId: '321' });
      const call = apiCalls()[0];
      expect(call?.method).toBe('POST');
      expect(call?.url).toBe('/api.php/Assistance/Ticket');
      expect(call?.headers['glpi-entity-recursive']).toBe('true');
      expect(call?.headers.authorization).toBe('Bearer token-1');
      expect(JSON.parse(call?.body ?? '{}')).toEqual({
        name: 'Impressora do RH offline',
        content: '**corpo**',
        type: 1,
        request_type: { id: 10 },
        urgency: 4,
        impact: 3,
        priority: 3,
      });
    });

    it('usa o tipo de requisição da configuração', async () => {
      handler = (_r, res) => json(res, 200, { id: 1 });
      await client({ requestTypeId: 4 }).createTicket(input);
      const sent = JSON.parse(apiCalls()[0]?.body ?? '{}') as { request_type: unknown };
      expect(sent.request_type).toEqual({ id: 4 });
    });

    it.each([
      ['id', { id: 55 }],
      ['ID', { ID: 55 }],
      ['ticket_id', { ticket_id: 55 }],
      ['id em texto', { id: '55' }],
    ])('lê o número do chamado em %s', async (_name, body) => {
      handler = (_r, res) => json(res, 200, body);
      expect(await client().createTicket(input)).toEqual({ ticketId: '55' });
    });

    it.each([
      [401, 'GLPI_AUTH', false],
      [403, 'GLPI_AUTH', false],
      [404, 'GLPI_NOT_FOUND', false],
      [422, 'GLPI_REJECTED', false],
      [400, 'GLPI_REJECTED', false],
      [500, 'GLPI_SERVER', false],
      [503, 'GLPI_SERVER', false],
    ])('HTTP %i vira %s e o resultado é conhecido', async (status, code, unknown) => {
      handler = (_r, res) => json(res, status, { message: 'detalhe interno do glpi' });
      const error = await failure(client().createTicket(input));
      expect(error?.code).toBe(code);
      expect(error?.outcomeUnknown).toBe(unknown);
      expect(error?.message).not.toContain('detalhe interno');
    });

    it.each([
      ['sem corpo JSON', (res: ServerResponse) => res.writeHead(200).end('não é json')],
      ['sem número', (res: ServerResponse) => json(res, 200, { ok: true })],
      ['número inválido', (res: ServerResponse) => json(res, 201, { id: 0 })],
    ])('2xx %s é resultado desconhecido', async (_name, respond) => {
      handler = (_r, res) => respond(res);
      const error = await failure(client().createTicket(input));
      expect(error?.code).toBe('GLPI_BAD_RESPONSE');
      expect(error?.outcomeUnknown).toBe(true);
    });

    it('sem resposta no prazo: timeout, resultado desconhecido, e nunca reenvia sozinho', async () => {
      handler = () => undefined;
      const error = await failure(client({ timeoutMs: 150 }).createTicket(input));
      expect(error?.code).toBe('GLPI_TIMEOUT');
      expect(error?.outcomeUnknown).toBe(true);
      expect(apiCalls()).toHaveLength(1);
    });

    it('conexão recusada (nada foi enviado) é indisponível, com resultado conhecido', async () => {
      // Uma porta que acabou de ser liberada: ninguém escuta nela (a porta 1 o fetch nem usa).
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const closedUrl = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`;
      await new Promise((resolve) => probe.close(resolve));
      const glpi = createGlpiClient({
        config: config({ url: closedUrl }),
        fetch: (url, init) => {
          if (String(url as string | URL).endsWith('/api.php/token')) {
            return Promise.resolve(Response.json({ access_token: 't', expires_in: 300 }));
          }
          return fetch(url, init);
        },
      });
      const error = await failure(glpi.createTicket(input));
      expect(error?.code).toBe('GLPI_UNAVAILABLE');
      expect(error?.outcomeUnknown).toBe(false);
    });

    it('401 na criação não repete o envio', async () => {
      handler = (_r, res) => json(res, 401, {});
      await failure(client().createTicket(input));
      expect(apiCalls()).toHaveLength(1);
    });
  });

  describe('leitura de chamados', () => {
    const item = (overrides: Record<string, unknown> = {}) => ({
      id: 7,
      name: 'Impressora offline',
      status: { id: 2 },
      date: '2026-03-02 09:00:00',
      date_mod: '2026-03-02 10:00:00',
      urgency: 4,
      content: '&lt;p&gt;texto&lt;/p&gt;',
      ...overrides,
    });

    it('lista pelo solicitante, do mais recente ao mais antigo, no máximo 50', async () => {
      handler = (_r, res) => json(res, 200, { data: [item()] });
      const tickets = await client().listTickets(42);
      const url = new URL(apiCalls()[0]?.url ?? '', 'http://x');
      expect(url.pathname).toBe('/api.php/Assistance/Ticket');
      expect(url.searchParams.get('filter')).toBe('user_recipient.id==42');
      expect(url.searchParams.get('sort')).toBe('date_mod:desc');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(tickets).toEqual([
        {
          id: '7',
          title: 'Impressora offline',
          statusId: 2,
          createdAt: '2026-03-02 09:00:00',
          updatedAt: '2026-03-02 10:00:00',
          urgency: 4,
          content: '&lt;p&gt;texto&lt;/p&gt;',
        },
      ]);
    });

    it.each([
      ['data', { data: [item()] }],
      ['data.items', { data: { items: [item()] } }],
      ['data.data', { data: { data: [item()] } }],
      ['lista na raiz', [item()]],
    ])('aceita a lista em %s', async (_name, body) => {
      handler = (_r, res) => json(res, 200, body);
      expect(await client().listTickets(1)).toHaveLength(1);
    });

    it('aceita status como número, data de criação alternativa e ignora itens sem id', async () => {
      handler = (_r, res) =>
        json(res, 200, {
          data: [
            item({ id: '9', status: 5, date: undefined, date_creation: '2026-03-01 08:00:00' }),
            { name: 'sem id' },
            item({ id: 'x' }),
          ],
        });
      const tickets = await client().listTickets(1);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]).toMatchObject({ id: '9', statusId: 5, createdAt: '2026-03-01 08:00:00' });
    });

    it.each([
      [401, 'GLPI_AUTH'],
      [500, 'GLPI_SERVER'],
    ])('listagem com HTTP %i vira %s', async (status, code) => {
      handler = (_r, res) => json(res, status, {});
      expect((await failure(client().listTickets(1)))?.code).toBe(code);
    });

    it('busca um chamado pelo número, com a resposta direta ou dentro de data', async () => {
      handler = (_r, res) => json(res, 200, item({ id: 55 }));
      expect((await client().getTicket('55'))?.id).toBe('55');
      expect(apiCalls()[0]?.url).toBe('/api.php/Assistance/Ticket/55');
      handler = (_r, res) => json(res, 200, { data: item({ id: 56 }) });
      expect((await client().getTicket('56'))?.id).toBe('56');
    });

    it('chamado inexistente (404) devolve nulo; outros erros viram GLPI_*', async () => {
      handler = (_r, res) => json(res, 404, {});
      expect(await client().getTicket('1')).toBeNull();
      handler = (_r, res) => json(res, 500, {});
      expect((await failure(client().getTicket('1')))?.code).toBe('GLPI_SERVER');
    });
  });

  describe('solicitante do chamado', () => {
    it('liga o usuário ao chamado como solicitante', async () => {
      handler = (_r, res) => json(res, 200, {});
      await client().attachRequester('321', 42);
      const call = apiCalls()[0];
      expect(call?.method).toBe('POST');
      expect(call?.url).toBe('/api.php/Assistance/Ticket/321/TeamMember');
      expect(JSON.parse(call?.body ?? '{}')).toEqual({ type: 'User', id: 42, role: 'requester' });
    });

    it('falha vira erro para quem chama decidir (o serviço só registra aviso)', async () => {
      handler = (_r, res) => json(res, 500, {});
      expect((await failure(client().attachRequester('321', 42)))?.code).toBe('GLPI_SERVER');
    });
  });
});

describe('GLPI falso', () => {
  it('abre chamados com números sequenciais e guarda o que recebeu', async () => {
    const fake = createFakeGlpi({ firstTicketId: 50 });
    expect(await fake.client.createTicket({ title: 'a', content: 'b', urgency: 3 })).toEqual({
      ticketId: '50',
    });
    expect(await fake.client.createTicket({ title: 'c', content: 'd', urgency: 3 })).toEqual({
      ticketId: '51',
    });
    await fake.client.attachRequester('50', 7);
    expect(fake.tickets[0]?.requesterId).toBe(7);
  });

  it('simula falha de criação, busca e vínculo', async () => {
    const fake = createFakeGlpi({
      createFails: new GlpiError('GLPI_TIMEOUT'),
      requester: 'missing',
      attachFails: true,
    });
    expect(await fake.client.findRequesterId('a@b.test')).toBeNull();
    expect(
      (await failure2(fake.client.createTicket({ title: 'a', content: 'b', urgency: 3 })))?.code,
    ).toBe('GLPI_TIMEOUT');
    expect((await failure2(fake.client.attachRequester('1', 1)))?.code).toBe('GLPI_SERVER');
    expect(fake.tickets).toHaveLength(0);
  });
});

async function failure2(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error as GlpiError,
  );
}
