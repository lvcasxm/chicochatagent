import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/auth/AuthContext';
import { ThemeProvider } from '../../app/theme/ThemeProvider';
import { readChatEvents } from '../../lib/sse';
import { ChatPage } from './ChatPage';

const CONVERSATION_ID = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';
const MESSAGE_ID = '7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'fulano@prefeitura.example.test',
  fullName: 'Fulano de Tal',
  role: 'user',
  defaultSector: null,
  privacyAccepted: true,
};
const CARDS = [
  {
    key: 'printer',
    title: 'Manutenção de Impressora',
    description: 'Problemas para imprimir',
    icon: null,
    action: 'chat',
    externalUrl: null,
    secondaryLink: null,
    cannedMessage: 'Olá! Estou com problemas na impressora do meu setor. Pode me ajudar?',
  },
  {
    key: 'sei',
    title: 'Dúvidas referentes ao SEI',
    description: 'Atendimento com o Joseias',
    icon: null,
    action: 'external_link',
    externalUrl: 'https://joseias.example.test',
    secondaryLink: { label: 'Ouvidoria', url: 'https://ouvidoria.example.test' },
    cannedMessage: null,
  },
];
const PORTAL = 'https://chamados.example.test/';

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Corpo SSE em pedaços (os cortes podem cair no meio de um evento). */
function sse(events: Array<[string, unknown]>, split = 7): Response {
  const text = events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const turn = (text: string, extra: Array<[string, unknown]> = []): Array<[string, unknown]> => [
  ['meta', { messageId: MESSAGE_ID, mode: 'normal' }],
  ['delta', { text }],
  ...extra,
  ['done', { messageId: MESSAGE_ID, title: 'Impressora' }],
];

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  const defaults: Record<string, Handler> = {
    'GET /api/me': () => json(200, ME),
    'GET /api/bootstrap': () =>
      json(200, { cards: CARDS, glpiPortalUrl: PORTAL, canUseTestMode: false }),
    'GET /api/conversations': () => json(200, { conversations: [] }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({ key, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const handler = routes[key] ?? defaults[key];
      return Promise.resolve(handler ? handler(init) : json(404, {}));
    }),
  );
  return calls;
}

function Location() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderChat(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/c/:conversationId" element={<ChatPage />} />
          </Routes>
          <Location />
        </AuthProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const composer = () => screen.findByRole('textbox', { name: /mensagem para o chicochat/i });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('leitor de eventos (SSE)', () => {
  async function collect(response: Response) {
    const out = [];
    for await (const event of readChatEvents(response.body as ReadableStream<Uint8Array>))
      out.push(event);
    return out;
  }

  it('monta os eventos mesmo com os cortes no meio, inclusive no meio de um acento', async () => {
    for (const split of [1, 2, 3, 5, 11, 4096]) {
      const events = await collect(sse(turn('Olá, você está bem? ção'), split));
      expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'done']);
      expect(events[1]?.data).toEqual({ text: 'Olá, você está bem? ção' });
    }
  });

  it('ignora evento desconhecido, JSON quebrado e dados fora do contrato', async () => {
    const body = [
      'event: bizarro\ndata: {"a":1}\n\n',
      'event: delta\ndata: {nao-e-json\n\n',
      'event: delta\ndata: {"text":42}\n\n',
      'event: delta\ndata: {"text":"ok"}\n\n',
      ': comentario\n\n',
    ].join('');
    const events = await collect(new Response(body));
    expect(events).toEqual([{ event: 'delta', data: { text: 'ok' } }]);
  });
});

describe('tela inicial', () => {
  it('mostra a pergunta, o campo, os atalhos e o link do portal', async () => {
    mockApi({});
    renderChat();
    expect(await screen.findByRole('heading', { name: 'Como posso te ajudar hoje?' })).toBeTruthy();
    expect(await composer()).toBeTruthy();
    expect(await screen.findByRole('button', { name: /manutenção de impressora/i })).toBeTruthy();
    const sei = await screen.findByRole('link', { name: /dúvidas referentes ao sei/i });
    expect(sei.getAttribute('target')).toBe('_blank');
    expect(sei.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('link', { name: /ouvidoria/i }).getAttribute('href')).toBe(
      'https://ouvidoria.example.test',
    );
    expect(screen.getByRole('link', { name: /sou usuário avançado/i }).getAttribute('href')).toBe(
      PORTAL,
    );
    expect(screen.getByText(/pode cometer erros/i)).toBeTruthy();
  });

  it('atalho de chat cria a conversa com a categoria e envia a mensagem pronta', async () => {
    const calls = mockApi({
      'POST /api/conversations': () =>
        json(201, {
          id: CONVERSATION_ID,
          title: null,
          categoryKey: 'printer',
          outcome: null,
          lastMessageAt: '2026-03-02T12:00:00.000Z',
        }),
      [`POST /api/conversations/${CONVERSATION_ID}/messages`]: () =>
        sse(turn('Qual é a **impressora**?')),
    });
    renderChat();
    await userEvent.click(await screen.findByRole('button', { name: /manutenção de impressora/i }));

    expect(await screen.findByText('impressora', { selector: 'strong' })).toBeTruthy();
    const create = calls.find((c) => c.key === 'POST /api/conversations');
    expect(create?.body).toEqual({ categoryKey: 'printer' });
    const message = calls.find((c) => c.key.endsWith('/messages'));
    expect(message?.body).toEqual({ content: CARDS[0]?.cannedMessage });
    // A rota passa a apontar para a conversa criada.
    await waitFor(() =>
      expect(screen.getByTestId('path').textContent).toBe(`/c/${CONVERSATION_ID}`),
    );
    // O texto da pessoa aparece como balão, e o da IA como texto corrido.
    expect(screen.getByText(CARDS[0]?.cannedMessage ?? '')).toBeTruthy();
  });
});

describe('composer', () => {
  function startMocks() {
    return mockApi({
      'POST /api/conversations': () =>
        json(201, {
          id: CONVERSATION_ID,
          title: null,
          categoryKey: null,
          outcome: null,
          lastMessageAt: '2026-03-02T12:00:00.000Z',
        }),
      [`POST /api/conversations/${CONVERSATION_ID}/messages`]: () => sse(turn('Entendi.')),
    });
  }

  it('Enter envia; Shift+Enter só quebra a linha', async () => {
    const calls = startMocks();
    renderChat();
    const field = await composer();
    await userEvent.type(field, 'primeira linha{Shift>}{Enter}{/Shift}segunda linha');
    expect(calls.some((c) => c.key.endsWith('/messages'))).toBe(false);
    expect((field as HTMLTextAreaElement).value).toBe('primeira linha\nsegunda linha');

    await userEvent.type(field, '{Enter}');
    await screen.findByText('Entendi.');
    expect(calls.find((c) => c.key.endsWith('/messages'))?.body).toEqual({
      content: 'primeira linha\nsegunda linha',
    });
  });

  it('não envia texto vazio nem só espaços', async () => {
    const calls = startMocks();
    renderChat();
    const field = await composer();
    await userEvent.type(field, '   {Enter}');
    expect(calls.some((c) => c.key === 'POST /api/conversations')).toBe(false);
    expect(screen.getByRole('button', { name: 'Enviar mensagem' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('sugere a categoria a partir de 6 caracteres e, ao clicar, envia a mensagem do assunto', async () => {
    const calls = startMocks();
    renderChat();
    await screen.findByRole('button', { name: /manutenção de impressora/i });
    const field = await composer();

    await userEvent.type(field, 'toner');
    expect(screen.queryByRole('button', { name: /parece sobre/i })).toBeNull(); // 5 caracteres

    await userEvent.type(field, ' acabou');
    const chip = await screen.findByRole('button', {
      name: /parece sobre.*manutenção de impressora/i,
    });
    await userEvent.click(chip);

    await screen.findByText('Entendi.');
    expect(calls.find((c) => c.key === 'POST /api/conversations')?.body).toEqual({
      categoryKey: 'printer',
    });
    expect(calls.find((c) => c.key.endsWith('/messages'))?.body).toEqual({
      content: 'Olá! Estou com um problema relacionado a manutenção de impressora. Pode me ajudar?',
    });
  });

  it('não sugere em parte de palavra', async () => {
    startMocks();
    renderChat();
    await screen.findByRole('button', { name: /manutenção de impressora/i });
    await userEvent.type(await composer(), 'falar com o Seixas amanhã');
    expect(screen.queryByRole('button', { name: /parece sobre/i })).toBeNull();
  });
});

describe('conversa', () => {
  const DETAIL = {
    id: CONVERSATION_ID,
    title: 'Impressora offline',
    categoryKey: null,
    outcome: null,
    lastMessageAt: '2026-03-02T12:00:00.000Z',
    messages: [
      {
        id: 'a1111111-1111-4111-8111-111111111111',
        role: 'user',
        content: 'A impressora está offline',
        incomplete: false,
        createdAt: '2026-03-02T11:59:00.000Z',
      },
      {
        id: 'b2222222-2222-4222-8222-222222222222',
        role: 'assistant',
        content: 'Reinicie a **impressora**.\n\n- passo um\n- passo dois',
        incomplete: false,
        createdAt: '2026-03-02T11:59:30.000Z',
      },
    ],
    triage: {
      resolutionAttempts: 1,
      issuePersists: null,
      ticketFormUnlocked: false,
      testMode: false,
      resolved: false,
    },
  };
  const MESSAGES_URL = `POST /api/conversations/${CONVERSATION_ID}/messages`;

  it('abre uma conversa antiga com o histórico, Markdown e título (RF-017)', async () => {
    mockApi({ [`GET /api/conversations/${CONVERSATION_ID}`]: () => json(200, DETAIL) });
    const { container } = renderChat(`/c/${CONVERSATION_ID}`);
    expect(await screen.findByRole('heading', { name: 'Impressora offline' })).toBeTruthy();
    expect(screen.getByText('A impressora está offline')).toBeTruthy();
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /manutenção de impressora/i })).toBeNull(); // sem tela inicial
  });

  it('conversa inexistente: mensagem clara e caminho para começar outra', async () => {
    mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () =>
        json(404, { error: { code: 'CONVERSATION_NOT_FOUND' } }),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    expect(await screen.findByText('Esta conversa não existe mais')).toBeTruthy();
    expect(screen.getByRole('link', { name: /começar uma nova conversa/i })).toBeTruthy();
  });

  it('o formulário liberado aparece ao recarregar, com o link do portal', async () => {
    mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () =>
        json(200, { ...DETAIL, triage: { ...DETAIL.triage, ticketFormUnlocked: true } }),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    expect(await screen.findByText('Abertura de chamado liberada')).toBeTruthy();
    expect(
      screen.getAllByRole('link', { name: /portal de chamados/i })[0]?.getAttribute('href'),
    ).toBe(PORTAL);
  });

  it('o evento ticket_form libera o aviso durante a conversa', async () => {
    mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () => json(200, DETAIL),
      [MESSAGES_URL]: () =>
        sse(turn('Vou abrir um chamado.', [['ticket_form', { testMode: false }]])),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    await userEvent.type(await composer(), 'não resolveu{Enter}');
    expect(await screen.findByText('Abertura de chamado liberada')).toBeTruthy();
  });

  it('falha antes da resposta: mensagem simples, portal e "Tentar novamente" que reenvia o mesmo texto', async () => {
    let attempt = 0;
    const calls = mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () => json(200, DETAIL),
      [MESSAGES_URL]: () =>
        ++attempt === 1
          ? json(503, {
              error: { code: 'AI_UNAVAILABLE', message: 'Serviço de IA indisponível no momento.' },
            })
          : sse(turn('Agora foi.')),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    await userEvent.type(await composer(), 'meu computador não liga{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Serviço de IA indisponível no momento.');
    expect(
      within(alert)
        .getByRole('link', { name: /portal de chamados/i })
        .getAttribute('href'),
    ).toBe(PORTAL);
    expect(alert.textContent).not.toMatch(/gemini|google|provedor|crédito/i);

    await userEvent.click(within(alert).getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Agora foi.')).toBeTruthy();
    const sent = calls.filter((c) => c.key === MESSAGES_URL).map((c) => c.body);
    expect(sent).toEqual([
      { content: 'meu computador não liga' },
      { content: 'meu computador não liga' },
    ]);
    // A mensagem da pessoa aparece uma vez só.
    expect(screen.getAllByText('meu computador não liga')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [429, 'RATE_LIMITED', 'Muitas solicitações. Tente novamente em alguns instantes.'],
    [
      503,
      'BUSY',
      'Alta demanda no momento. Aguarde alguns segundos e tente novamente — você não perdeu a conversa.',
    ],
    [409, 'TURN_IN_PROGRESS', 'Aguarde a resposta anterior terminar.'],
  ])('HTTP %i (%s) mostra a mensagem própria', async (status, code, message) => {
    mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () => json(200, DETAIL),
      [MESSAGES_URL]: () =>
        json(status, { error: { code } }, status === 503 ? { 'retry-after': '5' } : {}),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    await userEvent.type(await composer(), 'oi{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it('resposta cortada no meio: mantém o texto, marca como incompleta e avisa', async () => {
    mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () => json(200, DETAIL),
      [MESSAGES_URL]: () =>
        sse([
          ['meta', { messageId: MESSAGE_ID, mode: 'normal' }],
          ['delta', { text: 'Tente reiniciar' }],
          [
            'error',
            {
              code: 'AI_INTERRUPTED',
              message: 'A resposta foi interrompida. Você pode tentar de novo.',
            },
          ],
        ]),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    await userEvent.type(await composer(), 'continua{Enter}');
    expect(await screen.findByText('Tente reiniciar')).toBeTruthy();
    expect(screen.getByText('Resposta incompleta.')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('A resposta foi interrompida');
  });

  it('o que a IA escreve nunca vira HTML', async () => {
    mockApi({
      [`GET /api/conversations/${CONVERSATION_ID}`]: () => json(200, DETAIL),
      [MESSAGES_URL]: () =>
        sse(turn('Veja <img src=x onerror=alert(1)> e [clique](javascript:alert(1))')),
    });
    const { container } = renderChat(`/c/${CONVERSATION_ID}`);
    await userEvent.type(await composer(), 'oi{Enter}');
    await screen.findByText(/Veja/);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('lista de conversas', () => {
  const LIST = [
    {
      id: CONVERSATION_ID,
      title: 'Impressora offline',
      categoryKey: null,
      outcome: null,
      lastMessageAt: new Date().toISOString(),
    },
    {
      id: '99999999-9999-4999-8999-999999999999',
      title: null,
      categoryKey: null,
      outcome: null,
      lastMessageAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    },
  ];

  it('mostra título e tempo relativo e marca a conversa aberta', async () => {
    mockApi({
      'GET /api/conversations': () => json(200, { conversations: LIST }),
      [`GET /api/conversations/${CONVERSATION_ID}`]: () =>
        json(200, {
          ...LIST[0],
          messages: [],
          triage: {
            resolutionAttempts: 0,
            issuePersists: null,
            ticketFormUnlocked: false,
            testMode: false,
            resolved: false,
          },
        }),
    });
    renderChat(`/c/${CONVERSATION_ID}`);
    const open = await screen.findByRole('link', { name: /impressora offline/i });
    expect(open.getAttribute('aria-current')).toBe('page');
    expect(within(open).getByText('agora')).toBeTruthy();
    expect(screen.getByText('há 3 h')).toBeTruthy();
    expect(screen.getByText('Nova conversa', { selector: 'span' })).toBeTruthy(); // sem título
  });

  it('excluir pede confirmação e só depois remove da lista', async () => {
    const calls = mockApi({
      'GET /api/conversations': () => json(200, { conversations: LIST }),
      'DELETE /api/conversations/99999999-9999-4999-8999-999999999999': () =>
        new Response(null, { status: 204 }),
    });
    renderChat();
    await userEvent.click(
      await screen.findByRole('button', { name: /excluir a conversa nova conversa/i }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Excluir esta conversa?' });
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);

    await userEvent.click(
      screen.getByRole('button', { name: /excluir a conversa nova conversa/i }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Excluir' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /excluir a conversa nova conversa/i }),
      ).toBeNull(),
    );
    expect(calls.filter((c) => c.key.startsWith('DELETE'))).toHaveLength(1);
    expect(screen.getByRole('link', { name: /impressora offline/i })).toBeTruthy();
  });

  it('falha ao excluir: avisa e mantém a conversa', async () => {
    mockApi({
      'GET /api/conversations': () => json(200, { conversations: LIST }),
      'DELETE /api/conversations/99999999-9999-4999-8999-999999999999': () => json(500, {}),
    });
    renderChat();
    await userEvent.click(
      await screen.findByRole('button', { name: /excluir a conversa nova conversa/i }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Excluir' }),
    );
    expect(await screen.findByText(/não foi possível excluir/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /excluir a conversa nova conversa/i, hidden: true }),
    ).toBeTruthy();
  });

  it('lista vazia e falha ao carregar têm mensagem própria', async () => {
    mockApi({});
    renderChat();
    expect(await screen.findByText('As suas conversas aparecem aqui.')).toBeTruthy();
    cleanup();
    mockApi({ 'GET /api/conversations': () => json(500, {}) });
    renderChat();
    expect(await screen.findByText(/não foi possível carregar a lista/i)).toBeTruthy();
  });
});
