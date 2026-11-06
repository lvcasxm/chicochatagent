import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../app/auth/AuthContext';
import { ThemeProvider } from '../../app/theme/ThemeProvider';
import { ChatPage } from './ChatPage';

const ID = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';
const FEEDBACK_URL = `POST /api/conversations/${ID}/feedback`;
const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'fulano@prefeitura.example.test',
  fullName: 'Fulano de Tal',
  role: 'user',
  defaultSector: null,
  privacyAccepted: true,
};

type FeedbackState = 'unavailable' | 'available' | 'given';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function detail(feedback: FeedbackState) {
  return {
    id: ID,
    title: 'Impressora offline',
    categoryKey: null,
    outcome: feedback === 'unavailable' ? null : 'resolved',
    lastMessageAt: '2026-03-02T12:00:00.000Z',
    messages: [],
    triage: {
      resolutionAttempts: 1,
      issuePersists: null,
      ticketFormUnlocked: false,
      testMode: false,
      resolved: feedback !== 'unavailable',
      feedback,
    },
  };
}

function mockApi(feedback: FeedbackState, onFeedback?: () => Response) {
  const calls: Array<{ key: string; body: Record<string, unknown> | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({
        key,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      });
      if (key === 'GET /api/me') return Promise.resolve(json(200, ME));
      if (key === 'GET /api/bootstrap') {
        return Promise.resolve(
          json(200, { cards: [], glpiPortalUrl: null, canUseTestMode: false, lastSector: null }),
        );
      }
      if (key === 'GET /api/conversations')
        return Promise.resolve(json(200, { conversations: [] }));
      if (key === `GET /api/conversations/${ID}`) {
        return Promise.resolve(json(200, detail(feedback)));
      }
      if (key === FEEDBACK_URL) return Promise.resolve(onFeedback ? onFeedback() : json(204));
      return Promise.resolve(json(404, {}));
    }),
  );
  return calls;
}

function renderChat() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/c/${ID}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/c/:conversationId" element={<ChatPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const card = () => screen.findByRole('heading', { name: 'Como foi o atendimento?' });
const suggestionField = () => screen.getByLabelText(/quer deixar uma sugestão/i);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('avaliação do atendimento', () => {
  it('só aparece quando o servidor a libera', async () => {
    mockApi('unavailable');
    renderChat();
    await screen.findByRole('heading', { name: 'Impressora offline' });
    expect(screen.queryByText('Como foi o atendimento?')).toBeNull();
  });

  it('depois de enviada (given), não é oferecida de novo', async () => {
    mockApi('given');
    renderChat();
    await screen.findByRole('heading', { name: 'Impressora offline' });
    expect(screen.queryByText('Como foi o atendimento?')).toBeNull();
  });

  it('a nota é obrigatória: sem ela, o envio fica desativado', async () => {
    mockApi('available');
    renderChat();
    await card();
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Enviar avaliação' });
    expect(send.disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: /^4/ }));
    expect(send.disabled).toBe(false);
  });

  it('oferece as cinco notas, com o rótulo para leitor de tela, como um grupo de rádio', async () => {
    mockApi('available');
    renderChat();
    await card();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /^1.*Muito ruim/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^5.*Muito bom/ })).toBeTruthy();
  });

  it('envia a nota e a sugestão, agradece e não volta a pedir', async () => {
    const calls = mockApi('available');
    renderChat();
    await card();
    await userEvent.click(screen.getByRole('radio', { name: /^5/ }));
    await userEvent.type(suggestionField(), '  Foi rápido  ');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));

    expect(await screen.findByText('Obrigado pela avaliação.')).toBeTruthy();
    expect(calls.find((c) => c.key === FEEDBACK_URL)?.body).toEqual({
      rating: 5,
      suggestion: 'Foi rápido',
    });
    expect(screen.queryByRole('button', { name: 'Enviar avaliação' })).toBeNull();
  });

  it('sem sugestão, só a nota vai no corpo', async () => {
    const calls = mockApi('available');
    renderChat();
    await card();
    await userEvent.click(screen.getByRole('radio', { name: /^2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    await screen.findByText('Obrigado pela avaliação.');
    expect(calls.find((c) => c.key === FEEDBACK_URL)?.body).toEqual({ rating: 2 });
  });

  it('"Pular" esconde o pedido e ele não volta nesta conversa, nem ao reabrir', async () => {
    mockApi('available');
    const first = renderChat();
    await card();
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }));
    await waitFor(() => expect(screen.queryByText('Como foi o atendimento?')).toBeNull());
    first.unmount();

    // Abre a conversa de novo: o servidor ainda diz "disponível", mas a pessoa já pulou.
    renderChat();
    await screen.findByRole('heading', { name: 'Impressora offline' });
    expect(screen.queryByText('Como foi o atendimento?')).toBeNull();
  });

  it('"Pular" não envia nada ao servidor', async () => {
    const calls = mockApi('available');
    renderChat();
    await card();
    await userEvent.click(screen.getByRole('button', { name: 'Pular' }));
    expect(calls.some((c) => c.key === FEEDBACK_URL)).toBe(false);
  });

  it('falha ao enviar: avisa, mantém o que foi digitado e permite tentar de novo', async () => {
    let attempt = 0;
    const calls = mockApi('available', () => (++attempt === 1 ? json(500, {}) : json(204)));
    renderChat();
    await card();
    await userEvent.click(screen.getByRole('radio', { name: /^3/ }));
    await userEvent.type(suggestionField(), 'Texto');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível enviar a avaliação',
    );
    expect((suggestionField() as HTMLTextAreaElement).value).toBe('Texto');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^3/ }).checked).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    expect(await screen.findByText('Obrigado pela avaliação.')).toBeTruthy();
    expect(calls.filter((c) => c.key === FEEDBACK_URL)).toHaveLength(2);
  });

  it('"já enviada" (409) conta como enviada, sem erro', async () => {
    mockApi('available', () => json(409, { error: { code: 'FEEDBACK_ALREADY_SENT' } }));
    renderChat();
    await card();
    await userEvent.click(screen.getByRole('radio', { name: /^5/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }));
    expect(await screen.findByText('Obrigado pela avaliação.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a sugestão aceita no máximo 1000 caracteres', async () => {
    mockApi('available');
    renderChat();
    await card();
    expect(suggestionField().getAttribute('maxlength')).toBe('1000');
  });
});
