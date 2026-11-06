import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('mostra que o sistema está em funcionamento', async () => {
    respondWith(200, { status: 'ok', db: 'up' });
    render(<App />);
    expect(await screen.findByText('Sistema em funcionamento.')).toBeTruthy();
  });

  it('mostra quando o banco está indisponível', async () => {
    respondWith(503, { status: 'degraded', db: 'down' });
    render(<App />);
    expect(await screen.findByText('Banco de dados indisponível.')).toBeTruthy();
  });

  it('mostra erro quando a resposta não segue o contrato', async () => {
    respondWith(404, { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } });
    render(<App />);
    expect(await screen.findByText('Não foi possível consultar o sistema.')).toBeTruthy();
  });

  it('mostra erro quando a API está fora do ar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    render(<App />);
    expect(await screen.findByText('Não foi possível consultar o sistema.')).toBeTruthy();
  });
});
