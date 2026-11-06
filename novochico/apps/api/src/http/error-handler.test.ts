import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { AppError } from '../lib/errors';
import { captureLogger, fakeDb, testConfig } from '../../test/helpers';

async function appWithTestRoutes() {
  const { logger, output } = captureLogger();
  const app = createApp({ config: testConfig, logger, db: fakeDb(() => Promise.resolve()) });
  app.get('/boom', () => {
    throw new Error('detalhe interno: postgres://u:senha-vazada@host/db');
  });
  app.get('/known', () => {
    throw new AppError('CONFLICT', 409, 'Mensagem segura.');
  });
  app.get('/known-500', () => {
    throw new AppError('UPSTREAM', 502, 'Serviço externo indisponível.', {
      cause: new Error('token-interno-123'),
    });
  });
  app.post('/echo', () => ({ ok: true }));
  await app.ready();
  return { app, output };
}

describe('tratamento de erros', () => {
  it('responde 500 genérico sem vazar o detalhe do erro', async () => {
    const { app, output } = await appWithTestRoutes();
    const res = await app.inject('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Ocorreu um erro inesperado. Tente novamente.' },
    });
    expect(res.body).not.toContain('senha-vazada');
    // O detalhe técnico fica disponível para quem opera, só no log.
    expect(output()).toContain('Erro não tratado');
  });

  it('usa o código, o status e a mensagem de AppError', async () => {
    const { app } = await appWithTestRoutes();
    const res = await app.inject('/known');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'CONFLICT', message: 'Mensagem segura.' } });
  });

  it('não expõe a causa de um AppError', async () => {
    const { app } = await appWithTestRoutes();
    const res = await app.inject('/known-500');
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('token-interno-123');
  });

  it('responde 404 no formato padrão', async () => {
    const { app } = await appWithTestRoutes();
    const res = await app.inject('/nao-existe');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' },
    });
  });

  it('troca a mensagem de JSON inválido por uma fixa', async () => {
    const { app } = await appWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"quebrado":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' },
    });
  });

  it('recusa corpo acima de 64 KB', async () => {
    const { app } = await appWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ texto: 'a'.repeat(70 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });
});

describe('identificador de requisição e logs', () => {
  it('devolve um x-request-id gerado no servidor e ignora o do cliente', async () => {
    const { app } = await appWithTestRoutes();
    const res = await app.inject({
      url: '/known',
      headers: { 'x-request-id': 'forjado\ninjetado' },
    });
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('não registra a query string nem cabeçalhos sensíveis ao logar a requisição', async () => {
    const { app, output } = await appWithTestRoutes();
    await app.inject({
      url: '/known?token=valor-na-query',
      headers: { authorization: 'Bearer valor-no-header', cookie: 'sid=valor-no-cookie' },
    });
    const logs = output();
    expect(logs).toContain('/known');
    expect(logs).not.toContain('valor-na-query');
    expect(logs).not.toContain('valor-no-header');
    expect(logs).not.toContain('valor-no-cookie');
  });
});
