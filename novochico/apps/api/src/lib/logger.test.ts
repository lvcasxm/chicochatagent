import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers';

describe('logger', () => {
  it('redige campos sensíveis na raiz e um nível abaixo', () => {
    const { logger, output } = captureLogger();
    logger.info(
      {
        password: 'senha-xyz',
        email: 'fulano@example.test',
        content: 'conteúdo da conversa',
        user: { token: 'token-abc', fullName: 'Fulano de Tal' },
        req: { headers: { authorization: 'Bearer segredo', cookie: 'sid=cookie-secreto' } },
        module: 'teste',
      },
      'mensagem',
    );
    const line = output();
    for (const secret of [
      'senha-xyz',
      'fulano@example.test',
      'conteúdo da conversa',
      'token-abc',
      'Fulano de Tal',
      'Bearer segredo',
      'cookie-secreto',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
    // Campos não sensíveis continuam visíveis.
    expect(line).toContain('"module":"teste"');
  });

  it('não registra a query string da requisição', () => {
    const { logger, output } = captureLogger();
    logger.info({ req: { method: 'GET', url: '/api/algo?token=valor-secreto&x=1' } }, 'req');
    expect(output()).toContain('/api/algo');
    expect(output()).not.toContain('valor-secreto');
  });

  it('respeita o nível configurado', () => {
    const { logger, output } = captureLogger();
    logger.debug('detalhe');
    expect(output()).toBe('');
  });
});
