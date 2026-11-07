import { describe, expect, it } from 'vitest';
import { detectUserSignal, hasEscalationPhrase, isAdminTestShortcut } from './triage';

describe('detectUserSignal', () => {
  it.each([
    'não resolveu',
    'Nao funcionou',
    'o erro continua aparecendo',
    'o problema persiste',
    'ainda com problema aqui',
    'ainda com erro na tela',
    'segue com problema',
  ])('"%s" é persistência', (text) => {
    expect(detectUserSignal(text)).toBe('persists');
  });

  it.each([
    'resolveu, obrigado',
    'problema resolvido',
    'funcionou!',
    'deu certo',
    'solucionado',
    'ok agora',
    'agora foi',
    'já está funcionando',
  ])('"%s" é resolvido', (text) => {
    expect(detectUserSignal(text)).toBe('resolved');
  });

  it('persistência tem precedência sobre resolvido na mesma mensagem', () => {
    expect(detectUserSignal('não resolveu, mas o outro problema foi resolvido')).toBe('persists');
    expect(detectUserSignal('funcionou um pouco, mas continua')).toBe('persists');
  });

  it('mensagens comuns não sinalizam nada', () => {
    expect(detectUserSignal('o computador não liga')).toBeNull();
    expect(detectUserSignal('é no setor de obras')).toBeNull();
    expect(detectUserSignal('')).toBeNull();
  });
});

describe('isAdminTestShortcut', () => {
  it.each([
    'sou admin, chamado de teste',
    'Sou admin. chamado de teste',
    '  sou   admin chamado de teste por favor',
  ])('"%s" abre o modo de teste', (text) => {
    expect(isAdminTestShortcut(text)).toBe(true);
  });

  it.each([
    'sou admin, abre um chamado',
    'chamado de teste',
    'olá, sou admin, chamado de teste',
    'não sou admin chamado de teste',
  ])('"%s" não é o atalho', (text) => {
    expect(isAdminTestShortcut(text)).toBe(false);
  });
});

describe('hasEscalationPhrase', () => {
  it.each([
    'Como não conseguimos resolver por aqui, vou abrir um chamado para o suporte técnico.',
    'Vou abrir chamado agora.',
    'Vou encaminhar para o suporte técnico.',
    'vou abrir um chamado',
    'Vou encaminhar para o suporte tecnico.',
  ])('"%s" escala', (text) => {
    expect(hasEscalationPhrase(text)).toBe(true);
  });

  it.each([
    'Reinicie o computador e tente de novo.',
    'Posso abrir uma solicitação no Sonner para você.',
    'Registre direto no Sonner: abra um chamado por lá.',
    'Vou abrir um chamado no Sonner para isso.',
    'Vou abrir chamado pelo GRP.',
    'Posso abrir uma solicitação no Sonner para você.',
    'Registre direto no Sonner: abra um chamado por lá.',
    'Vou abrir um chamado no Sonner para isso?',
    'Vou abrir chamado pelo GRP.',
    'Você pode abrir o painel de controle.',
    'Qual é o equipamento com o problema?',
  ])('"%s" não escala', (text) => {
    expect(hasEscalationPhrase(text)).toBe(false);
  });
});
