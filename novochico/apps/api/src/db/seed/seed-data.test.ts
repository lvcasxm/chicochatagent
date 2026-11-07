import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_CATEGORY,
  INSTRUCTIONS_MAX_LENGTH,
  TICKET_CATEGORIES,
} from '@chicochat/shared';
import {
  CATEGORY_SEEDS,
  INTRANET_URL,
  JOSEIAS_URL,
  SEI_SUPPORT_EMAIL,
  SEI_URL,
  SONNER_GUIDE_URL,
} from './categories';
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
    // O atalho do Sonner abre conversa: é nela que se pede acesso a um módulo (ADR-045).
    expect(CATEGORY_SEEDS.find((c) => c.key === 'grp')?.action).toBe('chat');
    expect(CATEGORY_SEEDS.every((c) => !c.secondaryLinkUrl)).toBe(true);
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
      grp: ['sonner'],
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

describe('instruções iniciais', () => {
  it('não contêm marcadores técnicos, que são sinais fixos do código', () => {
    expect(INITIAL_INSTRUCTIONS).not.toContain('<<');
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/OPEN_TICKET_FORM|RESOLUTION_ATTEMPT/);
  });

  it('cabem no limite do banco e não estão vazias', () => {
    expect(INITIAL_INSTRUCTIONS.length).toBeGreaterThan(1000);
    expect(INITIAL_INSTRUCTIONS.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
  });

  it('o único e-mail é o canal público do SEI; nada de identificadores ou nomes de pessoas', () => {
    const emails = INITIAL_INSTRUCTIONS.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    expect(new Set(emails)).toEqual(new Set([SEI_SUPPORT_EMAIL]));
    expect(INITIAL_INSTRUCTIONS).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/lucas|lorrayne|pinheiro/i);
  });

  it('são organizadas nas três partes', () => {
    for (const heading of [
      '## A. Como atender',
      '## B. Decisão e encaminhamento',
      '## C. Procedimentos específicos',
      '### Sonner e GRP',
      '### SEI',
      '### Impressoras com defeito físico',
      '### Segurança da informação',
    ]) {
      expect(INITIAL_INSTRUCTIONS, heading).toContain(heading);
    }
  });

  it('trazem os canais e endereços oficiais', () => {
    for (const address of [
      SEI_URL,
      INTRANET_URL,
      JOSEIAS_URL,
      SEI_SUPPORT_EMAIL,
      SONNER_GUIDE_URL,
    ]) {
      expect(INITIAL_INSTRUCTIONS, address).toContain(address);
    }
  });

  it('Sonner: o módulo é obrigatório no pedido de acesso e a senha é por recuperação própria', () => {
    expect(INITIAL_INSTRUCTIONS).toContain('Sonner e GRP são o mesmo sistema');
    expect(INITIAL_INSTRUCTIONS).toContain('Não abra o chamado sem saber o módulo');
    expect(INITIAL_INSTRUCTIONS).toContain('recuperação de senha do próprio sistema');
  });

  it('impressoras: defeito físico vai ao GLPI, nunca direto à Repros', () => {
    expect(INITIAL_INSTRUCTIONS).toContain('repassa à Repros');
    expect(INITIAL_INSTRUCTIONS).toContain('não oriente a pessoa a procurar a Repros diretamente');
    expect(INITIAL_INSTRUCTIONS.match(/https?:\/\/\S*repros\S*/gi)).toBeNull();
  });

  it('o que é trabalho da equipe técnica e os casos graves estão na parte comum', () => {
    expect(INITIAL_INSTRUCTIONS).toContain('formatar o computador, abrir o gabinete, trocar peças');
    expect(INITIAL_INSTRUCTIONS).toContain('roteador ou no switch');
    expect(INITIAL_INSTRUCTIONS).toContain('desligue o equipamento da tomada');
    expect(INITIAL_INSTRUCTIONS).toContain('O setor inteiro está sem internet');
  });

  it('a Ouvidoria saiu', () => {
    expect(INITIAL_INSTRUCTIONS).not.toMatch(/ouvidoria/i);
  });

  it('o resumo da versão explica o que ela é', () => {
    expect(INITIAL_INSTRUCTIONS_SUMMARY).toContain('três partes');
  });
});
