import { describe, expect, it } from 'vitest';
import { isCannedGreeting, isPlaceholderTitle, smartConversationTitle } from './title';

describe('smartConversationTitle', () => {
  it.each([
    ['Olá! Estou com um problema no mouse', 'Mouse'],
    ['Oi, bom dia, estou com um problema na impressora', 'Impressora'],
    ['Meu computador não liga', 'Computador não liga'],
    ['Preciso de ajuda com a senha do e-mail', 'A senha do e-mail'],
    ['não consigo entrar no SEI. já tentei de tudo', 'Não consigo entrar no SEI'],
    ['A internet caiu!!!', 'A internet caiu'],
  ])('"%s" vira "%s"', (text, expected) => {
    expect(smartConversationTitle(text)).toBe(expected);
  });

  it('limita o tamanho cortando em palavra inteira, com reticências', () => {
    const title = smartConversationTitle(
      'o sistema de protocolo fica travando toda vez que tento anexar um documento grande',
    );
    expect(title.length).toBeLessThanOrEqual(51);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it('se só sobrar abertura, mantém o texto original', () => {
    expect(smartConversationTitle('Olá!')).toBe('Olá');
  });

  it('texto vazio dá título vazio', () => {
    expect(smartConversationTitle('   ')).toBe('');
  });

  it('nunca passa do limite da coluna (80)', () => {
    expect(smartConversationTitle('x'.repeat(500), 500).length).toBeLessThanOrEqual(80);
  });
});

describe('isCannedGreeting', () => {
  const canned = ['Olá! Estou com problemas na impressora do meu setor. Pode me ajudar?'];

  it('reconhece a mensagem pronta e o formato genérico', () => {
    expect(isCannedGreeting(canned[0] ?? '', canned)).toBe(true);
    expect(
      isCannedGreeting('Olá! Estou com um problema relacionado a rede. Pode me ajudar?', canned),
    ).toBe(true);
  });

  it('não confunde o que a pessoa escreveu', () => {
    expect(isCannedGreeting('Olá! Estou com problemas no mouse.', canned)).toBe(false);
  });
});

describe('isPlaceholderTitle', () => {
  const labels = ['Impressora', 'Internet/rede'];

  it('rótulo de card, saudação e vazio são provisórios', () => {
    expect(isPlaceholderTitle(null, labels)).toBe(true);
    expect(isPlaceholderTitle('  ', labels)).toBe(true);
    expect(isPlaceholderTitle('Impressora', labels)).toBe(true);
    expect(isPlaceholderTitle('Olá! Estou com...', labels)).toBe(true);
  });

  it('um título real não é provisório', () => {
    expect(isPlaceholderTitle('Papel atolado na impressora', labels)).toBe(false);
  });
});
