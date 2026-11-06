import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { AuthProvider } from '../../app/auth/AuthContext';
import { ThemeProvider } from '../../app/theme/ThemeProvider';

const TOKEN = 'A'.repeat(43);
const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'fulano@prefeitura.example.test',
  fullName: 'Fulano de Tal',
  role: 'user',
  defaultSector: null,
  privacyAccepted: true,
};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function mockApi(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const defaults: Record<string, () => Response> = {
    'GET /api/me': () => json(200, ME),
    'GET /api/bootstrap': () =>
      json(200, { cards: [], glpiPortalUrl: null, canUseTestMode: false, lastSector: null }),
    'GET /api/conversations': () => json(200, { conversations: [] }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      const handler = routes[key] ?? defaults[key];
      return Promise.resolve(handler ? handler() : json(404, {}));
    }),
  );
  return calls;
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const TICKETS = {
  notice: null,
  tickets: [
    {
      id: '1001',
      title: 'Impressora offline',
      statusLabel: 'Em atendimento',
      createdAt: '2026-03-02T15:00:00.000Z', // 12:00 em São Paulo
      updatedAt: '2026-03-03T01:30:00.000Z', // 22:30 do dia 02 em São Paulo
      urgencyLabel: 'Alta',
      description: 'Solicitante: Maria\n<b>não é negrito</b> <img src=x onerror=alert(1)>',
    },
    {
      id: '1000',
      title: '',
      statusLabel: null,
      createdAt: null,
      updatedAt: null,
      urgencyLabel: null,
      description: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Meus chamados', () => {
  it('lista os chamados com situação e datas no fuso de São Paulo', async () => {
    mockApi({ 'GET /api/tickets/mine': () => json(200, TICKETS) });
    renderAt('/chamados');
    expect(await screen.findByRole('heading', { name: 'Meus chamados' })).toBeTruthy();
    const first = await screen.findByRole('button', {
      name: /Chamado nº 1001: Impressora offline/,
    });
    expect(first.textContent).toContain('Em atendimento');
    expect(first.textContent).toContain('Aberto em 02/03/2026');
    expect(first.textContent).toMatch(/12:00/);
    expect(first.textContent).toMatch(/Atualizado em 02\/03\/2026,? 22:30/);
    // Chamado só com o registro local: mostra o que há, sem inventar situação.
    expect(screen.getByRole('button', { name: /Chamado nº 1000/ })).toBeTruthy();
  });

  it('abre os detalhes e mostra a descrição como texto, nunca como HTML', async () => {
    mockApi({ 'GET /api/tickets/mine': () => json(200, TICKETS) });
    const { container } = renderAt('/chamados');
    const row = await screen.findByRole('button', { name: /Chamado nº 1001/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');

    const panel = document.getElementById(row.getAttribute('aria-controls') ?? '');
    expect(panel?.textContent).toContain('<b>não é negrito</b> <img src=x onerror=alert(1)>');
    expect(within(panel as HTMLElement).getByText('Alta')).toBeTruthy();
    expect(container.querySelector('main b, main img')).toBeNull();

    await userEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('chamado sem descrição diz que não há', async () => {
    mockApi({ 'GET /api/tickets/mine': () => json(200, TICKETS) });
    renderAt('/chamados');
    await userEvent.click(await screen.findByRole('button', { name: /Chamado nº 1000/ }));
    expect(screen.getByText('Sem descrição disponível.')).toBeTruthy();
  });

  it.each([
    ['requester_not_found', /não encontramos o seu cadastro/i],
    ['glpi_unavailable', /sistema de chamados está indisponível/i],
  ])('aviso próprio para %s', async (notice, message) => {
    mockApi({ 'GET /api/tickets/mine': () => json(200, { ...TICKETS, notice }) });
    renderAt('/chamados');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chamado nº 1001/ })).toBeTruthy();
  });

  it('sem chamados: estado vazio com a próxima ação', async () => {
    mockApi({ 'GET /api/tickets/mine': () => json(200, { tickets: [], notice: null }) });
    renderAt('/chamados');
    expect(await screen.findByText('Nenhum chamado por aqui')).toBeTruthy();
    expect(screen.getByRole('link', { name: /falar com o chicochat/i }).getAttribute('href')).toBe(
      '/',
    );
  });

  it('erro: mensagem e "Tentar novamente" que recarrega', async () => {
    let attempt = 0;
    mockApi({
      'GET /api/tickets/mine': () => (++attempt === 1 ? json(500, {}) : json(200, TICKETS)),
    });
    renderAt('/chamados');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar os seus chamados',
    );
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('button', { name: /Chamado nº 1001/ })).toBeTruthy();
  });

  it('sem login, leva ao login e volta', async () => {
    mockApi({ 'GET /api/me': () => json(401, {}) });
    renderAt('/chamados');
    const link = await screen.findByRole('link', { name: /entrar com a conta google/i });
    expect(link.getAttribute('href')).toBe(
      `/api/auth/google?redirect=${encodeURIComponent('/chamados')}`,
    );
  });
});

describe('transcrição do chamado', () => {
  const TRANSCRIPT = {
    ticketId: '1001',
    title: 'Impressora offline',
    summary: 'Problema identificado:\nImpressora parou.',
    requesterName: 'Maria Silva',
    sector: 'Secretaria de Saúde',
    openedAt: '2026-03-02T15:00:00.000Z',
    messages: [
      {
        role: 'user',
        content: 'A impressora <img src=x onerror=alert(1)> parou',
        at: '2026-03-02T14:58:00.000Z',
      },
      {
        role: 'assistant',
        content: 'Qual é o modelo?\n\n- passo **um**',
        at: '2026-03-02T14:59:00.000Z',
      },
    ],
  };

  it('sem login, vai para o login e volta para a mesma transcrição', async () => {
    mockApi({ 'GET /api/me': () => json(401, {}) });
    renderAt(`/conversa/${TOKEN}`);
    const link = await screen.findByRole('link', { name: /entrar com a conta google/i });
    expect(link.getAttribute('href')).toBe(
      `/api/auth/google?redirect=${encodeURIComponent(`/conversa/${TOKEN}`)}`,
    );
  });

  it('mostra chamado, solicitante, setor, abertura, resumo e as mensagens, com "Servidor" para a pessoa', async () => {
    mockApi({ [`GET /api/transcripts/${TOKEN}`]: () => json(200, TRANSCRIPT) });
    renderAt(`/conversa/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Chamado nº 1001' })).toBeTruthy();
    expect(screen.getByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('Secretaria de Saúde')).toBeTruthy();
    expect(screen.getByText(/02\/03\/2026,? 12:00/)).toBeTruthy();
    expect(screen.getByText(/Impressora parou\./)).toBeTruthy();

    const items = screen.getAllByRole('listitem');
    expect(within(items[0] as HTMLElement).getByText('Servidor')).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('ChicoChat+')).toBeTruthy();
    // Nenhum nome da pessoa na fala dela: só o rótulo.
    expect(items[0]?.textContent).not.toContain('Maria');
  });

  it('o conteúdo da conversa é só texto: sem HTML e sem markdown interpretado', async () => {
    mockApi({ [`GET /api/transcripts/${TOKEN}`]: () => json(200, TRANSCRIPT) });
    const { container } = renderAt(`/conversa/${TOKEN}`);
    await screen.findByRole('heading', { name: 'Chamado nº 1001' });
    expect(container.querySelector('main img, main script, main strong, main b')).toBeNull();
    expect(screen.getByText(/A impressora <img src=x onerror=alert\(1\)> parou/)).toBeTruthy();
    expect(container.textContent).toContain('- passo **um**');
  });

  it('sem permissão e inexistente têm a mesma tela', async () => {
    mockApi({
      [`GET /api/transcripts/${TOKEN}`]: () =>
        json(404, { error: { code: 'TRANSCRIPT_NOT_FOUND' } }),
    });
    renderAt(`/conversa/${TOKEN}`);
    expect(await screen.findByText('Conversa não encontrada')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /ir para o início/i }).length).toBeGreaterThan(0);
  });

  it('erro de rede: tenta de novo', async () => {
    let attempt = 0;
    mockApi({
      [`GET /api/transcripts/${TOKEN}`]: () =>
        ++attempt === 1 ? json(500, {}) : json(200, TRANSCRIPT),
    });
    renderAt(`/conversa/${TOKEN}`);
    await screen.findByText('Não foi possível carregar a conversa');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('heading', { name: 'Chamado nº 1001' })).toBeTruthy();
    await waitFor(() => expect(attempt).toBe(2));
  });
});
