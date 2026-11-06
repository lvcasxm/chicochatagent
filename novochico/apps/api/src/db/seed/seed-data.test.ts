import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_CATEGORY,
  INSTRUCTIONS_MAX_LENGTH,
  TICKET_CATEGORIES,
} from '@chicochat/shared';
import { CATEGORY_SEEDS, JOSEIAS_URL, OUVIDORIA_GUIDE_URL, SONNER_GUIDE_URL } from './categories';
import { INITIAL_INSTRUCTIONS, INITIAL_INSTRUCTIONS_SUMMARY } from './initial-instructions';

describe('cards iniciais (Anexo C)', () => {
  const visible = CATEGORY_SEEDS.filter((card) => card.action !== 'hidden');
  const chatCards = CATEGORY_SEEDS.filter((card) => card.action === 'chat');

  it('têm chaves únicas', () => {
    const keys = CATEGORY_SEEDS.map((card) => card.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('os títulos visíveis são exatamente as categorias válidas de um chamado', () => {
    const titles = visible.map((card) => card.title).sort();
    const valid = TICKET_CATEGORIES.filter((title) => title !== DEFAULT_TICKET_CATEGORY).sort();
    expect(titles).toEqual(valid);
  });

  it('só o card "access" fica oculto', () => {
    const hidden = CATEGORY_SEEDS.filter((card) => card.action === 'hidden');
    expect(hidden.map((card) => card.key)).toEqual(['access']);
  });

  it('cards de link externo têm endereço https', () => {
    for (const card of CATEGORY_SEEDS.filter((c) => c.action === 'external_link')) {
      expect(card.externalUrl, card.key).toMatch(/^https:\/\//);
    }
    expect(CATEGORY_SEEDS.find((c) => c.key === 'sei')?.externalUrl).toBe(JOSEIAS_URL);
    expect(CATEGORY_SEEDS.find((c) => c.key === 'grp')?.secondaryLinkUrl).toBe(OUVIDORIA_GUIDE_URL);
  });

  it('SEI e Outra coisa? ficam por último, nessa ordem', () => {
    const order = [...visible].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(order.slice(-2).map((card) => card.key)).toEqual(['sei', 'other']);
  });

  describe('mensagens prontas', () => {
    // Palavra temática de cada categoria, para evitar mensagens trocadas entre cards.
    const KEYWORDS: Record<string, string[]> = {
      hardware: ['computador', 'equipamento'],
      network: ['internet', 'conexão'],
      email: ['e-mail'],
      security: ['segurança', 'vírus'],
      install: ['instalação'],
      printer: ['impressora'],
      password: ['senha'],
      other: ['demanda'],
    };

    it('todo card de conversa tem uma mensagem pronta e um rótulo curto', () => {
      for (const card of chatCards) {
        expect(card.cannedMessage, card.key).toBeTruthy();
        expect(card.shortLabel, card.key).toBeTruthy();
      }
    });

    it('começam com "Olá!" e são todas diferentes', () => {
      const messages = chatCards.map((card) => card.cannedMessage ?? '');
      for (const message of messages) expect(message).toMatch(/^Olá! /);
      expect(new Set(messages).size).toBe(messages.length);
    });

    it('citam a palavra temática da própria categoria', () => {
      for (const card of chatCards) {
        const keywords = KEYWORDS[card.key];
        expect(keywords, `palavras-chave de ${card.key}`).toBeDefined();
        const message = (card.cannedMessage ?? '').toLowerCase();
        expect(
          keywords?.some((word) => message.includes(word)),
          `${card.key}: ${message}`,
        ).toBe(true);
      }
    });
  });
});

describe('instruções iniciais (versão 1)', () => {
  it('não contêm marcadores técnicos, que são sinais fixos do código', () => {
    expect(INITIAL_INSTRUCTIONS).not.toContain('<<');
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/OPEN_TICKET_FORM|RESOLUTION_ATTEMPT/);
  });

  it('cabem no limite do banco e não estão vazias', () => {
    expect(INITIAL_INSTRUCTIONS.length).toBeGreaterThan(1000);
    expect(INITIAL_INSTRUCTIONS.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
  });

  it('não contêm e-mails, identificadores nem nomes de pessoas', () => {
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(INITIAL_INSTRUCTIONS).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/lucas|lorrayne|pinheiro/i);
  });

  it('mantêm as regras de encaminhamento do sistema anterior', () => {
    expect(INITIAL_INSTRUCTIONS).toContain(JOSEIAS_URL);
    expect(INITIAL_INSTRUCTIONS).toContain(SONNER_GUIDE_URL);
    expect(INITIAL_INSTRUCTIONS).toContain(OUVIDORIA_GUIDE_URL);
    expect(INITIAL_INSTRUCTIONS).toContain('Não redirecione para o Sonner');
    expect(INITIAL_INSTRUCTIONS).toContain('exclusivamente ao Joseias');
  });

  it('trazem a regra de impressoras informada pelo responsável, com discernimento', () => {
    expect(INITIAL_INSTRUCTIONS).toContain('feita pela empresa Repros');
    expect(INITIAL_INSTRUCTIONS).toContain(
      'registrar o chamado no GLPI, para a TI repassar à Repros',
    );
    expect(INITIAL_INSTRUCTIONS).toContain('A instalação e a configuração da impressora');
    expect(INITIAL_INSTRUCTIONS).toContain('Use discernimento');
    expect(INITIAL_INSTRUCTIONS).toContain('Não recuse o atendimento');
  });

  it('não inventam o endereço do site da Repros', () => {
    const repros = INITIAL_INSTRUCTIONS.match(/https?:\/\/\S*repros\S*/gi);
    expect(repros).toBeNull();
    expect(INITIAL_INSTRUCTIONS).toContain('sem inventar endereço');
  });

  it('têm um assunto para cada tema que conversa com o agente', () => {
    for (const heading of [
      '### Computador e Equipamentos',
      '### Rede e internet',
      '### E-mail e comunicação',
      '### Segurança da informação',
      '### Instalação de Programas',
      '### Acessos e Senhas',
      '### Manutenção de Impressora',
    ]) {
      expect(INITIAL_INSTRUCTIONS, heading).toContain(heading);
    }
  });

  it('não repetem regras fixas do código (IP, formulário, marcadores)', () => {
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/\bIP\b/);
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/formulário/i);
  });

  it('o resumo da versão lista o que a SATD ainda precisa completar', () => {
    expect(INITIAL_INSTRUCTIONS_SUMMARY).toContain('Pendente de revisão pela SATD');
    expect(INITIAL_INSTRUCTIONS_SUMMARY).toContain('site da Repros');
  });
});
