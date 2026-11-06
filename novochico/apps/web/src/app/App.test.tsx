import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LOGIN_ERROR_CODES, PRIVACY_NOTICE_VERSION } from '@chicochat/shared';
import { LOGIN_ERROR_MESSAGES } from '../features/auth/login-messages';
import { AppRoutes } from './App';
import { AuthProvider } from './auth/AuthContext';

const ME = {
  id: '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13',
  email: 'fulano@prefeitura.example.test',
  fullName: 'Fulano de Tal',
  role: 'user',
  defaultSector: null,
  privacyAccepted: true,
};

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Simula a API por "MÉTODO /caminho" e registra as chamadas feitas. */
function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ key: string; body: string | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({ key, body: typeof init?.body === 'string' ? init.body : undefined });
      const handler = routes[key];
      return Promise.resolve(handler ? handler(init) : json(404, {}));
    }),
  );
  return calls;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const loginLink = () => screen.findByRole('link', { name: /entrar com a conta google/i });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sem sessão', () => {
  it('leva ao login, guardando para onde voltar', async () => {
    mockApi({ 'GET /api/me': () => json(401, { error: { code: 'UNAUTHENTICATED' } }) });
    renderAt('/c/42?aba=2');

    const link = await loginLink();
    expect(link.getAttribute('href')).toBe(
      `/api/auth/google?redirect=${encodeURIComponent('/c/42?aba=2')}`,
    );
  });

  it('na página inicial, o destino é a própria página inicial', async () => {
    mockApi({ 'GET /api/me': () => json(401) });
    renderAt('/');
    expect((await loginLink()).getAttribute('href')).toBe('/api/auth/google?redirect=%2F');
  });

  it('o login vai direto para o servidor, que valida o destino', async () => {
    mockApi({ 'GET /api/me': () => json(401) });
    renderAt('/login?redirect=https://evil.test');
    // A interface não filtra: apenas repassa, e a API ignora o que não for um caminho interno.
    expect((await loginLink()).getAttribute('href')).toBe(
      `/api/auth/google?redirect=${encodeURIComponent('https://evil.test')}`,
    );
  });

  it('não mostra o conteúdo protegido nem o aviso de privacidade', async () => {
    mockApi({ 'GET /api/me': () => json(401) });
    renderAt('/');
    await loginLink();
    expect(screen.queryByRole('button', { name: /sair/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('erros de login', () => {
  for (const code of LOGIN_ERROR_CODES) {
    it(`mostra a mensagem fixa para "${code}"`, async () => {
      mockApi({ 'GET /api/me': () => json(401) });
      renderAt(`/login?error=${code}`);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(LOGIN_ERROR_MESSAGES[code]);
    });
  }

  it('ignora códigos desconhecidos e nunca exibe texto vindo da URL', async () => {
    mockApi({ 'GET /api/me': () => json(401) });
    renderAt('/login?error=<img src=x onerror=alert(1)>texto-injetado');
    await loginLink();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.innerHTML).not.toContain('texto-injetado');
  });

  it('não há mensagem quando o login é aberto sem erro', async () => {
    mockApi({ 'GET /api/me': () => json(401) });
    renderAt('/login');
    await loginLink();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('aviso de privacidade', () => {
  const pending = { ...ME, privacyAccepted: false };

  it('bloqueia o sistema enquanto não for aceito', async () => {
    mockApi({ 'GET /api/me': () => json(200, pending) });
    renderAt('/');

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Aviso de Privacidade e Segurança');
    expect(dialog.textContent).toContain('senhas');
    expect(dialog.textContent).toContain('dados de cidadãos');
    expect(screen.queryByText(/Olá, Fulano/)).toBeNull();
  });

  it('grava o aceite da versão atual no servidor e libera o sistema', async () => {
    const calls = mockApi({
      'GET /api/me': () => json(200, pending),
      'POST /api/me/privacy-ack': () => json(204),
    });
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: /li e concordo/i }));

    expect(await screen.findByText(/Olá, Fulano/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const ack = calls.find((call) => call.key === 'POST /api/me/privacy-ack');
    expect(JSON.parse(ack?.body ?? '{}')).toEqual({ version: PRIVACY_NOTICE_VERSION });
  });

  it('não libera o sistema se o servidor recusar o aceite, e permite tentar de novo', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/me': () => json(200, pending),
      'POST /api/me/privacy-ack': () => {
        attempts += 1;
        return attempts === 1 ? json(500, {}) : json(204);
      },
    });
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: /li e concordo/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível registrar');
    expect(screen.queryByText(/Olá, Fulano/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /li e concordo/i }));
    expect(await screen.findByText(/Olá, Fulano/)).toBeTruthy();
  });

  it('desativa o botão enquanto o aceite é enviado, para não enviar duas vezes', async () => {
    let release: () => void = () => undefined;
    const calls = mockApi({
      'GET /api/me': () => json(200, pending),
      'POST /api/me/privacy-ack': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(204));
        }),
    });
    renderAt('/');

    const button = await screen.findByRole('button', { name: /li e concordo/i });
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    release();

    await screen.findByText(/Olá, Fulano/);
    expect(calls.filter((call) => call.key === 'POST /api/me/privacy-ack')).toHaveLength(1);
  });
});

describe('com sessão', () => {
  it('mostra a página inicial com o primeiro nome', async () => {
    mockApi({ 'GET /api/me': () => json(200, ME) });
    renderAt('/');
    expect(await screen.findByText(/Olá, Fulano\./)).toBeTruthy();
  });

  it('quem já entrou é levado da tela de login para a página inicial', async () => {
    mockApi({ 'GET /api/me': () => json(200, ME) });
    renderAt('/login?error=failed');
    expect(await screen.findByText(/Olá, Fulano\./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /entrar com a conta google/i })).toBeNull();
  });

  it('sair encerra a sessão no servidor e volta ao login', async () => {
    const calls = mockApi({
      'GET /api/me': () => json(200, ME),
      'POST /api/auth/logout': () => json(204),
    });
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: /sair/i }));

    await loginLink();
    expect(calls.some((call) => call.key === 'POST /api/auth/logout')).toBe(true);
  });

  it('avisa se não conseguir sair, sem mostrar o usuário como deslogado', async () => {
    mockApi({
      'GET /api/me': () => json(200, ME),
      'POST /api/auth/logout': () => json(500, {}),
    });
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: /sair/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível sair');
    expect(screen.getByText(/Olá, Fulano\./)).toBeTruthy();
  });
});

describe('falhas ao consultar o sistema', () => {
  it('mostra o erro e permite tentar de novo quando a API falha', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/me': () => {
        attempts += 1;
        return attempts === 1 ? json(500, {}) : json(200, ME);
      },
    });
    renderAt('/');

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível consultar');
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText(/Olá, Fulano\./)).toBeTruthy();
  });

  it('trata uma resposta fora do contrato como erro, em vez de exibir dados quebrados', async () => {
    mockApi({ 'GET /api/me': () => json(200, { id: 'não-é-uuid', role: 'dono' }) });
    renderAt('/');
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível consultar');
  });

  it('trata a API fora do ar como erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderAt('/');
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível consultar');
  });
});
