import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { AuthProvider } from '../../app/auth/AuthContext';
import { ThemeProvider } from '../../app/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';

const ID = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';
const ADMIN = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'admin@prefeitura.example.test',
  fullName: 'Ana Admin',
  role: 'admin',
  defaultSector: null,
  privacyAccepted: true,
};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const apiError = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

interface Call {
  key: string;
  body: Record<string, unknown> | undefined;
}

function mockApi(routes: Record<string, (call: Call) => Response>, me: object = ADMIN) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? 'GET'} ${url}`;
      const call: Call = {
        key,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      };
      calls.push(call);
      if (key === 'GET /api/bootstrap') {
        return Promise.resolve(
          json(200, { cards: [], glpiPortalUrl: null, canUseTestMode: true, lastSector: null }),
        );
      }
      if (key === 'GET /api/conversations')
        return Promise.resolve(json(200, { conversations: [] }));
      const handler = routes[key];
      if (handler) return Promise.resolve(handler(call));
      if (key === 'GET /api/me') return Promise.resolve(json(200, me));
      return Promise.resolve(json(404, {}));
    }),
  );
  return calls;
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

// A administração é carregada sob demanda; pré-carregar evita esperar o import em cada teste.
beforeAll(async () => {
  await import('./AdminRoutes');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- acesso */

describe('acesso à administração', () => {
  it('quem não é administrador vê o aviso e a tela não chama a API de administração', async () => {
    const calls = mockApi({}, { ...ADMIN, role: 'user' });
    renderAt('/admin');
    expect(await screen.findByText('Esta área é só para administradores')).toBeTruthy();
    expect(calls.some((c) => c.key.includes('/api/admin/'))).toBe(false);
  });

  it('sem login, vai para o login e volta para a administração', async () => {
    mockApi({ 'GET /api/me': () => json(401, {}) }, ADMIN);
    renderAt('/admin/instrucoes');
    const link = await screen.findByRole('link', { name: /entrar com a conta google/i });
    expect(link.getAttribute('href')).toBe(
      `/api/auth/google?redirect=${encodeURIComponent('/admin/instrucoes')}`,
    );
  });

  it('o administrador vê a navegação com as seis áreas e a auditoria', async () => {
    mockApi({
      'GET /api/admin/metrics?period=30d': () => json(200, METRICS),
    });
    renderAt('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Administração' });
    for (const name of [
      'Visão geral',
      'Conversas',
      'Instruções do agente',
      'Cards da tela inicial',
      'Prompt efetivo',
      'Usuários e papéis',
      'Auditoria',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeTruthy();
    }
  });

  it('o chat mostra o atalho da administração só para administradores', async () => {
    mockApi({});
    renderAt('/');
    const list = await screen.findByRole('navigation', { name: 'Conversas' });
    const shield = await within(list).findByRole('link', { name: 'Painel de administração' });
    expect(shield.getAttribute('href')).toBe('/admin');
    cleanup();
    mockApi({}, { ...ADMIN, role: 'user' });
    renderAt('/');
    await screen.findByRole('button', { name: /sair/i });
    expect(screen.queryByRole('link', { name: /administração/i })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- visão geral */

const METRICS = {
  period: '30d',
  from: '2026-02-01T03:00:00.000Z',
  to: '2026-03-02T12:00:00.000Z',
  indicators: {
    users: 12,
    sessions: 40,
    messages: 310,
    tickets: 6,
    failures: 1,
    averageRating: 4.5,
    ratingCount: 8,
    averageConversationMinutes: 7.5,
  },
  outcomes: { resolved: 20, escalated: 6, noOutcome: 9, open: 2 },
  series: [
    { date: '2026-03-01', sessions: 3, users: 2, tickets: 0 },
    { date: '2026-03-02', sessions: 5, users: 4, tickets: 1 },
  ],
  funnel: { users: 12, sessions: 40, answered: 35, escalated: 6, tickets: 6 },
  topCategories: [{ key: 'network', count: 9 }],
  topSectors: [{ sector: 'Secretaria de Saúde', count: 4 }],
  ratingDistribution: [
    { rating: 1, count: 0 },
    { rating: 2, count: 1 },
    { rating: 3, count: 1 },
    { rating: 4, count: 2 },
    { rating: 5, count: 4 },
  ],
  recentSessions: [
    {
      conversationId: ID,
      title: 'Impressora offline',
      categoryKey: 'printer',
      outcome: 'escalated',
      lastMessageAt: '2026-03-02T11:00:00.000Z',
    },
  ],
  recentFailures: [
    {
      id: ID,
      createdAt: '2026-03-02T09:00:00.000Z',
      status: 'failed',
      errorCode: 'GLPI_DOWN',
      conversationId: ID,
    },
  ],
};

describe('visão geral', () => {
  it('mostra os indicadores e separa resolvido, escalonado e sem desfecho', async () => {
    mockApi({ 'GET /api/admin/metrics?period=30d': () => json(200, METRICS) });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeTruthy();
    await screen.findByText('Pessoas atendidas');

    const stat = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).parentElement?.textContent ?? '';
    expect(stat('Pessoas atendidas')).toContain('12');
    expect(stat('Sessões')).toContain('40');
    expect(stat('Nota média')).toContain('4,5');
    expect(stat('Nota média')).toContain('8 avaliações');
    expect(stat('Resolvido (confirmado)')).toContain('20');
    expect(stat('Escalonado')).toContain('6');
    expect(stat('Sem desfecho')).toContain('9');
    expect(stat('Em andamento')).toContain('2');
    expect(screen.getByText('GLPI_DOWN', { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Impressora offline/ }).getAttribute('href')).toBe(
      `/admin/conversas/${ID}`,
    );
  });

  it('o gráfico tem alternativa em texto com os mesmos números', async () => {
    mockApi({ 'GET /api/admin/metrics?period=30d': () => json(200, METRICS) });
    renderAt('/admin');
    await screen.findByRole('img', { name: /sessões por dia/i });
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[2]?.textContent).toContain('02/03/2026');
  });

  it('trocar o período busca de novo com o período escolhido', async () => {
    const calls = mockApi({
      'GET /api/admin/metrics?period=30d': () => json(200, METRICS),
      'GET /api/admin/metrics?period=7d': () =>
        json(200, { ...METRICS, period: '7d', indicators: { ...METRICS.indicators, users: 3 } }),
    });
    renderAt('/admin');
    await screen.findByText('Pessoas atendidas');
    await userEvent.click(screen.getByRole('combobox', { name: 'Período' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Últimos 7 dias' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/admin/metrics?period=7d')).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByText('Pessoas atendidas').parentElement?.textContent).toContain('3'),
    );
  });

  it('sem dados, diz "Sem dados" em vez de inventar zero', async () => {
    mockApi({
      'GET /api/admin/metrics?period=30d': () =>
        json(200, {
          ...METRICS,
          indicators: {
            ...METRICS.indicators,
            averageRating: null,
            averageConversationMinutes: null,
          },
          recentSessions: [],
          recentFailures: [],
          topCategories: [],
          topSectors: [],
        }),
    });
    renderAt('/admin');
    expect(await screen.findAllByText('Sem dados')).toHaveLength(2);
    expect(screen.getByText('Nenhuma falha no período.')).toBeTruthy();
  });

  it('erro: mensagem e "Tentar novamente"', async () => {
    let attempt = 0;
    mockApi({
      'GET /api/admin/metrics?period=30d': () =>
        ++attempt === 1 ? json(500, {}) : json(200, METRICS),
    });
    renderAt('/admin');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar os indicadores',
    );
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Pessoas atendidas')).toBeTruthy();
  });

  it('a exportação aponta para o CSV do período escolhido', async () => {
    mockApi({ 'GET /api/admin/metrics?period=30d': () => json(200, METRICS) });
    renderAt('/admin');
    const link = await screen.findByRole('link', { name: 'Mensagens' });
    expect(link.getAttribute('href')).toBe('/api/admin/export/messages?period=30d');
    expect(link.hasAttribute('download')).toBe(true);
    expect(
      screen.getAllByRole('link', { name: /^(Conversas|Mensagens|Chamados|Eventos|Avaliações)$/ }),
    ).toBeTruthy();
  });

  describe('análise por IA', () => {
    const RESULT = {
      summary: 'Muitos pedidos sobre impressoras.',
      insights: [
        {
          theme: 'Impressoras',
          description: 'Fila travada',
          estimatedConversations: 7,
          severity: 'alta',
          examples: ['não imprime'],
          recommendation: 'Reiniciar o spooler',
        },
      ],
      analyzedConversations: 40,
      truncated: false,
    };

    it('envia o período, mostra o resumo e os temas', async () => {
      const calls = mockApi({
        'GET /api/admin/metrics?period=30d': () => json(200, METRICS),
        'POST /api/admin/insights': () => json(200, RESULT),
      });
      renderAt('/admin');
      await userEvent.click(await screen.findByRole('button', { name: /analisar/i }));
      expect(await screen.findByText('Muitos pedidos sobre impressoras.')).toBeTruthy();
      expect(screen.getByText('Impressoras')).toBeTruthy();
      expect(screen.getByText(/Reiniciar o spooler/)).toBeTruthy();
      expect(screen.queryByText(/usou só uma parte/)).toBeNull();
      expect(calls.find((c) => c.key === 'POST /api/admin/insights')?.body).toEqual({
        period: '30d',
      });
    });

    it('avisa quando a amostra foi cortada', async () => {
      mockApi({
        'GET /api/admin/metrics?period=30d': () => json(200, METRICS),
        'POST /api/admin/insights': () => json(200, { ...RESULT, truncated: true }),
      });
      renderAt('/admin');
      await userEvent.click(await screen.findByRole('button', { name: /analisar/i }));
      expect(await screen.findByText(/usou só uma parte das conversas/)).toBeTruthy();
    });

    it('mostra a mensagem do servidor quando a IA falha', async () => {
      mockApi({
        'GET /api/admin/metrics?period=30d': () => json(200, METRICS),
        'POST /api/admin/insights': () =>
          apiError(503, 'AI_UNAVAILABLE', 'A IA não respondeu. Tente novamente.'),
      });
      renderAt('/admin');
      await userEvent.click(await screen.findByRole('button', { name: /analisar/i }));
      expect((await screen.findByRole('alert')).textContent).toContain('A IA não respondeu');
    });
  });
});

/* -------------------------------------------------------------------------- conversas */

const CONVERSATIONS = {
  conversations: [
    {
      id: ID,
      title: 'Impressora offline',
      categoryKey: 'printer',
      outcome: 'escalated',
      sector: 'Procuradoria',
      userName: 'Maria Souza',
      userEmail: 'maria@prefeitura.example.test',
      isTest: false,
      createdAt: '2026-03-02T10:00:00.000Z',
      lastMessageAt: '2026-03-02T11:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 25,
  hasMore: false,
};

describe('conversas', () => {
  it('lista e busca pelo termo digitado', async () => {
    const calls = mockApi({
      'GET /api/admin/conversations?page=1': () => json(200, CONVERSATIONS),
      'GET /api/admin/conversations?q=maria&page=1': () => json(200, CONVERSATIONS),
    });
    renderAt('/admin/conversas');
    expect(await screen.findByText('Impressora offline')).toBeTruthy();
    expect(screen.getByText(/maria@prefeitura.example.test/)).toBeTruthy();
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar/i }), 'maria');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/admin/conversations?q=maria&page=1')).toBe(true),
    );
  });

  it('sem resultados: estado vazio', async () => {
    mockApi({
      'GET /api/admin/conversations?page=1': () =>
        json(200, { ...CONVERSATIONS, conversations: [] }),
    });
    renderAt('/admin/conversas');
    expect(await screen.findByText('Nenhuma conversa encontrada')).toBeTruthy();
  });

  it('pagina: "Próxima" pede a página 2', async () => {
    const calls = mockApi({
      'GET /api/admin/conversations?page=1': () => json(200, { ...CONVERSATIONS, hasMore: true }),
      'GET /api/admin/conversations?page=2': () => json(200, { ...CONVERSATIONS, page: 2 }),
    });
    renderAt('/admin/conversas');
    await userEvent.click(await screen.findByRole('button', { name: 'Próxima' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/admin/conversations?page=2')).toBe(true),
    );
  });

  it('a leitura mostra a mensagem como texto, nunca como HTML, e avisa da auditoria', async () => {
    mockApi({
      [`GET /api/admin/conversations/${ID}`]: () =>
        json(200, {
          ...CONVERSATIONS.conversations[0],
          messages: [
            {
              id: ID,
              role: 'user',
              source: null,
              content: 'Veja <img src=x onerror=alert(1)> e **negrito**',
              incomplete: false,
              createdAt: '2026-03-02T10:00:00.000Z',
            },
          ],
          tickets: [
            {
              id: ID,
              status: 'success',
              glpiTicketId: '9001',
              isTest: false,
              createdAt: '2026-03-02T10:30:00.000Z',
            },
          ],
          feedback: { rating: 3, suggestion: 'Poderia ser mais rápido' },
        }),
    });
    const { container } = renderAt(`/admin/conversas/${ID}`);
    expect(await screen.findByText(/registrada na auditoria/)).toBeTruthy();
    expect(screen.getByText(/Veja <img src=x onerror=alert\(1\)> e \*\*negrito\*\*/)).toBeTruthy();
    expect(container.querySelector('main img, main strong, main b')).toBeNull();
    expect(screen.getByText(/Chamado nº 9001/)).toBeTruthy();
    expect(screen.getByText(/Nota 3 de 5: Poderia ser mais rápido/)).toBeTruthy();
  });

  it('conversa inexistente: mensagem própria', async () => {
    mockApi({
      [`GET /api/admin/conversations/${ID}`]: () =>
        apiError(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.'),
    });
    renderAt(`/admin/conversas/${ID}`);
    expect(await screen.findByText('Conversa não encontrada')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- instruções */

function version(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    status: 'published',
    content: 'Linha A\nLinha B\nLinha C',
    changeRequest: null,
    changeSummary: null,
    conflicts: [],
    questions: [],
    createdBy: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    publishedBy: { name: 'Ana Admin' },
    publishedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

/** O histórico não leva o texto das versões. */
function withoutContent(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'content'));
}

function instructionsState(overrides: Record<string, unknown> = {}) {
  const history = withoutContent(version());
  return {
    published: version(),
    draft: null,
    history: [history],
    maxLength: 20000,
    aiAvailable: true,
    ...overrides,
  };
}

const DRAFT = version({
  version: 2,
  status: 'draft',
  content: 'Linha A\nLinha NOVA\nLinha C',
  changeRequest: 'Troque a linha B',
  changeSummary: 'Trocou a linha B por uma nova.',
  conflicts: ['Conflita com a linha C.'],
  questions: ['Qual é o prazo?'],
  createdBy: { name: 'Ana Admin' },
  publishedBy: null,
  publishedAt: null,
});

describe('instruções do agente', () => {
  it('mostra o que está em uso e que não há rascunho', async () => {
    mockApi({ 'GET /api/admin/instructions': () => json(200, instructionsState()) });
    renderAt('/admin/instrucoes');
    expect((await screen.findAllByText(/Versão 1/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Não há rascunho/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pedir à IA' }).hasAttribute('disabled')).toBe(true);
  });

  it('pedir à IA envia o pedido e mostra resumo, conflitos, dúvidas e o antes e depois', async () => {
    const calls = mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState()),
      'POST /api/admin/instructions/propose': () => json(200, DRAFT),
    });
    renderAt('/admin/instrucoes');
    await userEvent.type(await screen.findByLabelText(/o que deve mudar/i), 'Troque a linha B');
    await userEvent.click(screen.getByRole('button', { name: 'Pedir à IA' }));

    expect(await screen.findByText('Rascunho (versão 2)')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/admin/instructions/propose')?.body).toEqual({
      request: 'Troque a linha B',
    });
    expect(screen.getByText('Trocou a linha B por uma nova.')).toBeTruthy();
    expect(screen.getByText('Conflita com a linha C.')).toBeTruthy();
    expect(screen.getByText('Qual é o prazo?')).toBeTruthy();
    // O antes e o depois: a linha nova acrescentada e a antiga removida, ditas em texto.
    const diff = screen.getByRole('group', { name: /diferenças/i });
    expect(within(diff).getByText('Linha NOVA')).toBeTruthy();
    expect(diff.textContent).toContain('Acrescentado: ');
    expect(diff.textContent).toContain('Removido: ');
  });

  it('no documento longo, o antes e depois mostra só o que mudou e permite ver tudo', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Linha ${i}`);
    const longDraft = { ...DRAFT, content: [...lines, 'Linha ACRESCENTADA'].join('\n') };
    mockApi({
      'GET /api/admin/instructions': () =>
        json(
          200,
          instructionsState({
            published: version({ content: lines.join('\n') }),
            draft: longDraft,
          }),
        ),
    });
    renderAt('/admin/instrucoes');
    const diff = await screen.findByRole('group', { name: /diferenças/i });
    expect(within(diff).getByText('Linha ACRESCENTADA')).toBeTruthy();
    expect(within(diff).queryByText('Linha 3')).toBeNull();
    expect(within(diff).getByText('38 linhas sem mudança')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar o texto inteiro' }));
    expect(
      within(screen.getByRole('group', { name: /diferenças/i })).getByText('Linha 3'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mostrar só o que mudou' })).toBeTruthy();
  });

  it('a IA fora do ar mostra a mensagem do servidor e não cria rascunho', async () => {
    mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState()),
      'POST /api/admin/instructions/propose': () =>
        apiError(502, 'PROPOSAL_INVALID', 'A IA devolveu um documento que não pode ser usado.'),
    });
    renderAt('/admin/instrucoes');
    await userEvent.type(await screen.findByLabelText(/o que deve mudar/i), 'Mude');
    await userEvent.click(screen.getByRole('button', { name: 'Pedir à IA' }));
    expect((await screen.findByRole('alert')).textContent).toContain('não pode ser usado');
    expect(screen.queryByText(/Rascunho \(versão/)).toBeNull();
  });

  it('sem IA configurada, avisa e mantém a edição manual', async () => {
    mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState({ aiAvailable: false })),
    });
    renderAt('/admin/instrucoes');
    expect(await screen.findByText(/A IA não está configurada/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pedir à IA' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /comece a editar o texto em uso/i })).toBeTruthy();
  });

  it('edição manual: salvar envia o texto; sem salvar, publicar fica bloqueado', async () => {
    const calls = mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
      'PUT /api/admin/instructions/draft': () =>
        json(200, { ...DRAFT, content: 'Texto editado à mão' }),
    });
    renderAt('/admin/instrucoes');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar o texto' }));
    const area = screen.getByLabelText('Texto do rascunho');
    await userEvent.clear(area);
    await userEvent.type(area, 'Texto editado à mão');

    expect(
      screen.getByRole('button', { name: 'Publicar o rascunho' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText('Salve as edições antes de publicar.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar o rascunho' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PUT /api/admin/instructions/draft')?.body).toEqual({
        content: 'Texto editado à mão',
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Publicar o rascunho' }).hasAttribute('disabled'),
      ).toBe(false),
    );
  });

  it('publicar pede confirmação, envia a versão vista e mostra o resultado', async () => {
    let published = false;
    const calls = mockApi({
      'GET /api/admin/instructions': () =>
        json(
          200,
          published
            ? instructionsState({ published: { ...DRAFT, status: 'published' } })
            : instructionsState({ draft: DRAFT }),
        ),
      'POST /api/admin/instructions/draft/publish': () => {
        published = true;
        return json(200, { version: 2 });
      },
    });
    renderAt('/admin/instrucoes');
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar o rascunho' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar a versão 2?' });
    expect(dialog.textContent).toContain('A partir da próxima mensagem');
    expect(calls.some((c) => c.key === 'POST /api/admin/instructions/draft/publish')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === 'POST /api/admin/instructions/draft/publish')?.body,
      ).toEqual({
        version: 2,
      }),
    );
    expect(await screen.findByText(/Versão 2 publicada/)).toBeTruthy();
    expect(await screen.findByText(/Não há rascunho/)).toBeTruthy();
  });

  it('cancelar a publicação não envia nada', async () => {
    const calls = mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
    });
    renderAt('/admin/instrucoes');
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar o rascunho' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(calls.some((c) => c.key.startsWith('POST /api/admin/instructions/draft/publish'))).toBe(
      false,
    );
  });

  it('rascunho que mudou: mostra o motivo e não publica', async () => {
    mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
      'POST /api/admin/instructions/draft/publish': () =>
        apiError(409, 'DRAFT_CHANGED', 'O rascunho mudou desde que você o abriu.'),
    });
    renderAt('/admin/instrucoes');
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar o rascunho' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publicar' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('O rascunho mudou');
  });

  it('histórico: ver o texto de uma versão e restaurar como rascunho', async () => {
    const old = version({ version: 1, status: 'archived' });
    const oldSummary = withoutContent(old);
    const calls = mockApi({
      'GET /api/admin/instructions': () =>
        json(
          200,
          instructionsState({
            published: version({ version: 2, content: 'Atual' }),
            history: [{ ...oldSummary, version: 2, status: 'published' }, oldSummary],
          }),
        ),
      'GET /api/admin/instructions/versions/1': () => json(200, old),
      'POST /api/admin/instructions/1/restore': () =>
        json(
          200,
          version({
            version: 3,
            status: 'draft',
            content: old.content,
            changeSummary: 'Restaurada da versão 1.',
          }),
        ),
    });
    renderAt('/admin/instrucoes');
    const [, openOld] = await screen.findAllByRole('button', { name: 'Ver o texto' });
    await userEvent.click(openOld!);
    expect((await screen.findByRole('dialog', { name: 'Versão 1' })).textContent).toContain(
      'Linha B',
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Fechar' }).at(-1)!,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Criar o rascunho' }));
    expect(await screen.findByText('Rascunho (versão 3)')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /api/admin/instructions/1/restore')).toBe(true);
  });

  describe('ensaio', () => {
    function sse(events: Array<[string, unknown]>) {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const [name, data] of events) {
              controller.enqueue(
                encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            }
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }

    it('mostra a resposta do rascunho e os marcadores como avisos, sem gravar nada', async () => {
      const calls = mockApi({
        'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
        'POST /api/admin/instructions/draft/rehearse': () =>
          sse([
            ['delta', { text: 'Vou abrir ' }],
            ['delta', { text: 'um chamado.' }],
            ['marker', { kind: 'open_ticket_form' }],
            ['done', {}],
          ]),
      });
      renderAt('/admin/instrucoes');
      await userEvent.click(await screen.findByRole('button', { name: 'Ensaiar' }));
      expect(screen.getByText(/Nada é gravado/)).toBeTruthy();
      await userEvent.type(
        screen.getByLabelText('Mensagem para o agente'),
        'Minha impressora parou',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

      expect(await screen.findByText('Vou abrir um chamado.')).toBeTruthy();
      expect(
        screen.getByText('Aqui o formulário de chamado seria liberado para a pessoa.'),
      ).toBeTruthy();
      expect(
        calls.find((c) => c.key === 'POST /api/admin/instructions/draft/rehearse')?.body,
      ).toEqual({
        messages: [{ role: 'user', content: 'Minha impressora parou' }],
      });
      // Só o ensaio é chamado: nada de conversas, mensagens ou chamados reais.
      expect(calls.filter((c) => c.key.startsWith('POST')).map((c) => c.key)).toEqual([
        'POST /api/admin/instructions/draft/rehearse',
      ]);
    });

    it('a segunda mensagem leva o histórico do ensaio', async () => {
      const calls = mockApi({
        'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
        'POST /api/admin/instructions/draft/rehearse': () =>
          sse([
            ['delta', { text: 'Resposta' }],
            ['done', {}],
          ]),
      });
      renderAt('/admin/instrucoes');
      await userEvent.click(await screen.findByRole('button', { name: 'Ensaiar' }));
      const field = screen.getByLabelText('Mensagem para o agente');
      await userEvent.type(field, 'Primeira');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await screen.findByText('Resposta');
      await userEvent.type(field, 'Segunda');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await waitFor(() => expect(calls.filter((c) => c.key.includes('rehearse'))).toHaveLength(2));
      expect(calls.filter((c) => c.key.includes('rehearse'))[1]?.body).toEqual({
        messages: [
          { role: 'user', content: 'Primeira' },
          { role: 'assistant', content: 'Resposta' },
          { role: 'user', content: 'Segunda' },
        ],
      });
    });

    it('erro do servidor aparece como aviso', async () => {
      mockApi({
        'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
        'POST /api/admin/instructions/draft/rehearse': () =>
          apiError(503, 'AI_UNAVAILABLE', 'Serviço de IA indisponível no momento.'),
      });
      renderAt('/admin/instrucoes');
      await userEvent.click(await screen.findByRole('button', { name: 'Ensaiar' }));
      await userEvent.type(screen.getByLabelText('Mensagem para o agente'), 'Oi');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      expect((await screen.findByRole('alert')).textContent).toContain('indisponível');
    });
  });
});

/* -------------------------------------------------------------------------- cards */

const CARD = {
  id: ID,
  key: 'hardware',
  title: 'Computador e Equipamentos',
  cardDescription: 'Não liga?',
  icon: 'Monitor',
  action: 'chat',
  externalUrl: null,
  secondaryLinkLabel: null,
  secondaryLinkUrl: null,
  cannedMessage: 'Olá!',
  shortLabel: 'Computador',
  sortOrder: 10,
  active: true,
};

describe('cards da tela inicial', () => {
  it('lista com a ação e a ordem', async () => {
    mockApi({
      'GET /api/admin/categories': () =>
        json(200, {
          categories: [
            CARD,
            {
              ...CARD,
              id: '4a9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f14',
              key: 'old',
              title: 'Antigo',
              active: false,
            },
          ],
        }),
    });
    renderAt('/admin/categorias');
    expect(await screen.findByText('Computador e Equipamentos')).toBeTruthy();
    expect(screen.getByText(/Antigo \(inativo\)/)).toBeTruthy();
    expect(screen.getAllByText(/Abre uma conversa/)).toHaveLength(2);
  });

  it('criar: mostra os erros por campo antes de enviar', async () => {
    const calls = mockApi({ 'GET /api/admin/categories': () => json(200, { categories: [] }) });
    renderAt('/admin/categorias');
    await userEvent.click(await screen.findByRole('button', { name: 'Novo card' }));
    await userEvent.type(screen.getByLabelText('Identificador'), 'Inválido!');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Use letras minúsculas/)).toBeTruthy();
    expect(screen.getByText(/Informe um título/)).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /api/admin/categories')).toBe(false);
  });

  it('criar: link externo exige endereço válido', async () => {
    mockApi({ 'GET /api/admin/categories': () => json(200, { categories: [] }) });
    renderAt('/admin/categorias');
    await userEvent.click(await screen.findByRole('button', { name: 'Novo card' }));
    await userEvent.type(screen.getByLabelText('Identificador'), 'guia');
    await userEvent.type(screen.getByLabelText('Título'), 'Guia');
    await userEvent.click(screen.getByRole('combobox', { name: 'O que o card faz' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Abre um link' }));
    await userEvent.type(screen.getByLabelText('Endereço do link'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/começando com http/)).toBeTruthy();
  });

  it('criar com dados válidos envia o card e recarrega a lista', async () => {
    let listed = 0;
    const calls = mockApi({
      'GET /api/admin/categories': () =>
        ++listed === 1 ? json(200, { categories: [] }) : json(200, { categories: [CARD] }),
      'POST /api/admin/categories': () => json(201, CARD),
    });
    renderAt('/admin/categorias');
    await userEvent.click(await screen.findByRole('button', { name: 'Novo card' }));
    await userEvent.type(screen.getByLabelText('Identificador'), 'hardware');
    await userEvent.type(screen.getByLabelText('Título'), 'Computador e Equipamentos');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Computador e Equipamentos')).toBeTruthy();
    expect(calls.find((c) => c.key === 'POST /api/admin/categories')?.body).toMatchObject({
      key: 'hardware',
      title: 'Computador e Equipamentos',
      action: 'chat',
      externalUrl: null,
      active: true,
    });
  });

  it('apagar pede confirmação', async () => {
    const calls = mockApi({
      'GET /api/admin/categories': () => json(200, { categories: [CARD] }),
      [`DELETE /api/admin/categories/${ID}`]: () => new Response(null, { status: 204 }),
    });
    renderAt('/admin/categorias');
    await userEvent.click(await screen.findByRole('button', { name: 'Apagar' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apagar' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === `DELETE /api/admin/categories/${ID}`)).toBe(true),
    );
  });
});

/* -------------------------------------------------------------------------- prompt, usuários, auditoria */

describe('prompt efetivo', () => {
  it('mostra as duas partes, só leitura', async () => {
    mockApi({
      'GET /api/admin/prompt': () =>
        json(200, {
          text: 'REGRAS FIXAS + instruções',
          adminExtra: 'BYPASS',
          version: 'abc123',
          instructionsVersion: 4,
        }),
    });
    renderAt('/admin/prompt');
    expect(await screen.findByText('REGRAS FIXAS + instruções')).toBeTruthy();
    expect(screen.getByText('BYPASS')).toBeTruthy();
    expect(screen.getByText('Versão 4')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

const USERS = {
  users: [
    {
      id: ID,
      email: 'bea@prefeitura.example.test',
      fullName: 'Beatriz Alves',
      role: 'user',
      lastLoginAt: '2026-03-01T10:00:00.000Z',
      disabled: false,
    },
  ],
  page: 1,
  pageSize: 25,
  hasMore: false,
};

describe('usuários e papéis', () => {
  async function pickRole(name: string) {
    await userEvent.click(await screen.findByRole('combobox', { name: 'Papel de Beatriz Alves' }));
    await userEvent.click(await screen.findByRole('option', { name }));
  }

  it('mudar o papel pede confirmação e envia PATCH', async () => {
    const calls = mockApi({
      'GET /api/admin/users?page=1': () => json(200, USERS),
      [`PATCH /api/admin/users/${ID}/role`]: () => new Response(null, { status: 204 }),
    });
    renderAt('/admin/usuarios');
    await pickRole('Administrador');
    const dialog = await screen.findByRole('dialog', { name: 'Mudar o papel?' });
    expect(dialog.textContent).toContain('Beatriz Alves');
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /api/admin/users/${ID}/role`)?.body).toEqual({
        role: 'admin',
      }),
    );
    expect(await screen.findByText(/agora é administrador/i)).toBeTruthy();
  });

  it('o último administrador: mostra a explicação do servidor', async () => {
    mockApi({
      'GET /api/admin/users?page=1': () =>
        json(200, { ...USERS, users: [{ ...USERS.users[0], role: 'admin' }] }),
      [`PATCH /api/admin/users/${ID}/role`]: () =>
        apiError(409, 'LAST_ADMIN', 'Não é possível remover o último administrador do sistema.'),
    });
    renderAt('/admin/usuarios');
    await pickRole('Servidor');
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('último administrador');
  });

  it('cancelar não envia nada', async () => {
    const calls = mockApi({ 'GET /api/admin/users?page=1': () => json(200, USERS) });
    renderAt('/admin/usuarios');
    await pickRole('Técnico (lê transcrições)');
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
  });
});

describe('auditoria', () => {
  const AUDIT = {
    entries: [
      {
        id: ID,
        createdAt: '2026-03-02T11:00:00.000Z',
        action: 'user.role_changed',
        actorName: 'Ana Admin',
        targetType: 'user',
        targetId: ID,
        metadata: { from: 'user', to: 'admin' },
      },
    ],
    page: 1,
    pageSize: 25,
    hasMore: false,
  };

  it('lista a ação em português, quem fez e os detalhes simples', async () => {
    mockApi({ 'GET /api/admin/audit?page=1': () => json(200, AUDIT) });
    renderAt('/admin/auditoria');
    expect(await screen.findByText('Papel alterado')).toBeTruthy();
    expect(screen.getByText(/Ana Admin/)).toBeTruthy();
    expect(screen.getByText(/from: user · to: admin/)).toBeTruthy();
  });

  it('filtra por tipo de ação', async () => {
    const calls = mockApi({
      'GET /api/admin/audit?page=1': () => json(200, AUDIT),
      'GET /api/admin/audit?action=export.created&page=1': () =>
        json(200, { ...AUDIT, entries: [] }),
    });
    renderAt('/admin/auditoria');
    await screen.findByText('Papel alterado');
    await userEvent.click(screen.getByRole('combobox', { name: 'Tipo de ação' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Exportação de dados' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/admin/audit?action=export.created&page=1')).toBe(
        true,
      ),
    );
    expect(await screen.findByText('Nenhum registro')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- acessibilidade */

describe('acessibilidade das telas de administração', () => {
  // O jsdom não calcula estilos: o contraste é verificado sobre os tokens em tokens.test.ts.
  async function violations(container: HTMLElement) {
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
  }

  it('visão geral', async () => {
    mockApi({ 'GET /api/admin/metrics?period=30d': () => json(200, METRICS) });
    const { container } = renderAt('/admin');
    await screen.findByText('Pessoas atendidas');
    expect(await violations(container)).toEqual([]);
  });

  it('instruções, com rascunho aberto no ensaio', async () => {
    mockApi({
      'GET /api/admin/instructions': () => json(200, instructionsState({ draft: DRAFT })),
    });
    const { container } = renderAt('/admin/instrucoes');
    expect(await violations(container)).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: 'Ensaiar' }));
    expect(await violations(container)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Editar o texto' }));
    expect(await violations(container)).toEqual([]);
  });

  it('conversas, cards, usuários e auditoria', async () => {
    mockApi({
      'GET /api/admin/conversations?page=1': () => json(200, CONVERSATIONS),
      'GET /api/admin/categories': () => json(200, { categories: [CARD] }),
      'GET /api/admin/users?page=1': () => json(200, USERS),
      'GET /api/admin/audit?page=1': () =>
        json(200, { entries: [], page: 1, pageSize: 25, hasMore: false }),
    });
    for (const [path, ready] of [
      ['/admin/conversas', 'Impressora offline'],
      ['/admin/categorias', 'Computador e Equipamentos'],
      ['/admin/usuarios', 'Beatriz Alves'],
      ['/admin/auditoria', 'Nenhum registro'],
    ] as const) {
      const { container, unmount } = renderAt(path);
      await screen.findByText(ready);
      expect(await violations(container), path).toEqual([]);
      unmount();
    }
  });
});
