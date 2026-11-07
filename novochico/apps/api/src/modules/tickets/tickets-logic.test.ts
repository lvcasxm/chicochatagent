import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScriptedLlm } from '../../integrations/gemini/fake';
import { LlmError } from '../../integrations/gemini/llm';
import { buildTicketContent } from './description';
import {
  detectCollectiveIncident,
  findSimilarTickets,
  jaccard,
  tokenize,
  type CurrentCase,
  type PastTicket,
} from './duplicate-detection';
import {
  buildFallbackSummary,
  buildTestSummary,
  mostSignificantUserMessage,
} from './fallback-summary';
import {
  SUMMARY_SECTIONS,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  normalizeDescription,
  withRequesterContext,
  parseSummary,
  summarizeWithLlm,
} from './summary';
import { SUMMARY_SYSTEM_PROMPT } from './summary-prompt';

const SECTIONS_TEXT = SUMMARY_SECTIONS.map((name) => `${name}:\nTexto de ${name}.`).join('\n\n');
const valid = (overrides: Record<string, unknown> = {}) => ({
  titulo: 'Impressora do RH não envia documentos',
  descricao: SECTIONS_TEXT,
  categoria: 'Manutenção de Impressora',
  urgencia: 3,
  ...overrides,
});

describe('resumo: formato da saída', () => {
  it('aceita as seis seções, na ordem, e devolve o formato canônico', () => {
    const summary = parseSummary(valid(), null);
    expect(summary).toMatchObject({
      title: 'Impressora do RH não envia documentos',
      category: 'Manutenção de Impressora',
      urgency: 3,
      source: 'llm',
    });
    expect(summary?.description).toBe(SECTIONS_TEXT);
  });

  it('normaliza títulos com # e ** antes de validar', () => {
    const decorated = SUMMARY_SECTIONS.map((name, i) =>
      i % 2 === 0 ? `### **${name}:**\nCorpo ${i}` : `**${name}**:\nCorpo ${i}`,
    ).join('\n\n');
    const description = normalizeDescription(decorated);
    expect(description).toBe(
      SUMMARY_SECTIONS.map((name, i) => `${name}:\nCorpo ${i}`).join('\n\n'),
    );
  });

  it('aceita o corpo na mesma linha do título e corpo com várias linhas', () => {
    const text = SUMMARY_SECTIONS.map((name) => `${name}: linha um\nlinha dois`).join('\n');
    expect(normalizeDescription(text)).toBe(
      SUMMARY_SECTIONS.map((name) => `${name}:\nlinha um\nlinha dois`).join('\n\n'),
    );
  });

  it('seção fora de ordem, repetida, ausente ou vazia é falha', () => {
    const swapped: string[] = [...SUMMARY_SECTIONS];
    [swapped[1], swapped[2]] = [swapped[2] ?? '', swapped[1] ?? ''];
    expect(normalizeDescription(swapped.map((n) => `${n}:\nx`).join('\n\n'))).toBeNull();
    expect(normalizeDescription(`${SECTIONS_TEXT}\n\nContexto:\nrepetido`)).toBeNull();
    expect(
      normalizeDescription(
        SUMMARY_SECTIONS.slice(0, 5)
          .map((n) => `${n}:\nx`)
          .join('\n\n'),
      ),
    ).toBeNull();
    expect(
      normalizeDescription(
        SUMMARY_SECTIONS.map((n, i) => (i === 3 ? `${n}:` : `${n}:\nx`)).join('\n\n'),
      ),
    ).toBeNull();
    expect(normalizeDescription('texto solto sem seções')).toBeNull();
  });

  it.each([
    ['não é objeto', 'texto'],
    ['sem título', { descricao: SECTIONS_TEXT }],
    ['título vazio', valid({ titulo: '   ' })],
    ['título com 81 caracteres (não se corta depois, B-06)', valid({ titulo: 'x'.repeat(81) })],
    ['descrição inválida', valid({ descricao: 'sem seções' })],
    ['nulo', null],
  ])('saída inválida: %s', (_name, output) => {
    expect(parseSummary(output, null)).toBeNull();
  });

  it('título com exatamente 80 caracteres passa', () => {
    expect(parseSummary(valid({ titulo: 'x'.repeat(80) }), null)?.title).toHaveLength(80);
  });

  it.each([
    [1, 1],
    [5, 5],
    [4, 4],
    [0, 3],
    [6, 3],
    [2.5, 3],
    ['abc', 3],
    [undefined, 3],
    ['4', 4],
  ])('urgência %s vira %s', (input, expected) => {
    expect(parseSummary(valid({ urgencia: input }), null)?.urgency).toBe(expected);
  });

  it('categoria: a da IA, se válida; senão a do atalho; senão a geral', () => {
    // A conversa pode ter mudado de assunto depois do atalho.
    expect(parseSummary(valid(), 'Rede e internet')?.category).toBe('Manutenção de Impressora');
    expect(parseSummary(valid({ categoria: 'Inventada' }), 'Rede e internet')?.category).toBe(
      'Rede e internet',
    );
    expect(parseSummary(valid(), null)?.category).toBe('Manutenção de Impressora');
    expect(parseSummary(valid({ categoria: 'Inventada' }), null)?.category).toBe(
      'Suporte técnico geral',
    );
    expect(parseSummary(valid({ categoria: undefined }), null)?.category).toBe(
      'Suporte técnico geral',
    );
    // "Teste" só existe no modo teste, nunca pela IA.
    expect(parseSummary(valid({ categoria: 'Teste' }), null)?.category).toBe(
      'Suporte técnico geral',
    );
  });
});

describe('resumo: prompt', () => {
  it('o texto do Anexo B continua idêntico ao documento', () => {
    const doc = readFileSync(
      new URL('../../../../../docs/SONNET_CONTEXT.md', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(doc).toContain(SUMMARY_SYSTEM_PROMPT);
    expect(SUMMARY_SYSTEM_PROMPT).toContain('Máximo 80 caracteres');
    expect(SUMMARY_SYSTEM_PROMPT).toContain('Nenhuma tentativa prévia informada.');
  });

  it('acrescenta o formato JSON e a lista de categorias permitidas', () => {
    const prompt = buildSummarySystemPrompt();
    expect(prompt.startsWith(SUMMARY_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain('"titulo", "descricao", "categoria" e "urgencia"');
    expect(prompt).toContain('"Suporte técnico geral"');
    expect(prompt).not.toContain('"Teste"');
  });

  it('a conversa vai na mensagem do usuário, com o setor e a categoria do atalho', () => {
    const text = buildSummaryUserPrompt({
      sector: 'Secretaria de Saúde',
      cardCategory: 'Rede e internet',
      transcript: [
        { role: 'user', content: 'a internet caiu' },
        { role: 'assistant', content: 'Qual o equipamento?' },
      ],
    });
    expect(text).toContain('Setor do usuário: Secretaria de Saúde');
    expect(text).toContain(
      'Categoria do atalho escolhido no início (troque se a conversa mostrar outro assunto): Rede e internet',
    );
    expect(text).toContain('USUÁRIO: a internet caiu');
    expect(text).toContain('BOT: Qual o equipamento?');
  });
});

describe('resumo: tentativas', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const base = {
    sector: 'Saúde',
    cardCategory: null,
    transcript: [{ role: 'user' as const, content: 'o PC não liga' }],
  };

  it('sucesso na primeira tentativa', async () => {
    const { client, jsonCalls } = createScriptedLlm([], [valid()]);
    const summary = await summarizeWithLlm({
      ...base,
      llm: client,
      signal: new AbortController().signal,
    });
    expect(summary?.source).toBe('llm');
    expect(jsonCalls).toHaveLength(1);
    expect(jsonCalls[0]?.system).toContain(SUMMARY_SYSTEM_PROMPT);
  });

  it('JSON inválido e falha da IA contam como tentativa, com espera de (n-1) × 800 ms', async () => {
    const { client, jsonCalls } = createScriptedLlm(
      [],
      [{ titulo: 'sem descrição' }, new LlmError('unavailable'), valid()],
    );
    const pending = summarizeWithLlm({
      ...base,
      llm: client,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(jsonCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(jsonCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(jsonCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1599);
    expect(jsonCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)?.source).toBe('llm');
    expect(jsonCalls).toHaveLength(3);
  });

  it('depois de três falhas devolve nulo (o serviço usa a contingência)', async () => {
    const failures: number[] = [];
    const { client, jsonCalls } = createScriptedLlm([], [null, null, null, valid()]);
    const pending = summarizeWithLlm({
      ...base,
      llm: client,
      signal: new AbortController().signal,
      onFailure: (attempt) => failures.push(attempt),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeNull();
    expect(jsonCalls).toHaveLength(3);
    expect(failures).toEqual([1, 2, 3]);
  });

  it('cliente que desistiu interrompe as tentativas', async () => {
    const controller = new AbortController();
    const { client, jsonCalls } = createScriptedLlm([], [null, null, null]);
    const pending = summarizeWithLlm({ ...base, llm: client, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeNull();
    expect(jsonCalls.length).toBeLessThan(3);
  });
});

describe('resumo: contingência sem IA', () => {
  const canned = [
    'Olá! Tenho uma demanda de TI que não se encaixa nas opções listadas. Pode me ajudar?',
  ];

  it('usa a maior fala significativa, ignorando saudação e mensagem pronta', () => {
    const transcript = [
      { role: 'user' as const, content: 'Oi' },
      { role: 'user' as const, content: canned[0] ?? '' },
      { role: 'assistant' as const, content: 'Qual é o problema?' },
      { role: 'user' as const, content: 'A impressora do setor parou de imprimir' },
      { role: 'user' as const, content: 'não resolveu' },
    ];
    expect(mostSignificantUserMessage(transcript, canned)).toBe(
      'A impressora do setor parou de imprimir',
    );
  });

  it('limita a 2500 caracteres', () => {
    const long = 'x'.repeat(3000);
    expect(mostSignificantUserMessage([{ role: 'user', content: long }], [])).toHaveLength(2500);
  });

  it('sem fala significativa, usa o texto padrão', () => {
    const summary = buildFallbackSummary({
      sector: 'Saúde',
      cardCategory: null,
      transcript: [{ role: 'user', content: 'Olá' }],
      cannedMessages: canned,
    });
    expect(summary.description).toContain(
      'Problema identificado:\nOs detalhes do problema não puderam ser consolidados automaticamente no momento da abertura.',
    );
  });

  it('título, urgência e categoria seguem a especificação, e a transcrição não entra', () => {
    const summary = buildFallbackSummary({
      sector: 'Secretaria de Saúde',
      cardCategory: 'Rede e internet',
      transcript: [
        { role: 'user', content: 'A internet caiu no setor' },
        { role: 'assistant', content: 'RESPOSTA-DO-BOT-QUE-NAO-DEVE-ENTRAR' },
      ],
      cannedMessages: [],
    });
    expect(summary).toMatchObject({
      title: 'Solicitação de suporte — Secretaria de Saúde',
      urgency: 3,
      category: 'Rede e internet',
      source: 'fallback',
    });
    expect(summary.description).toContain('Problema identificado:\nA internet caiu no setor');
    expect(summary.description).toContain('Contexto:\nEscopo não confirmado pelo usuário.');
    expect(summary.description).not.toContain('RESPOSTA-DO-BOT');
    expect(normalizeDescription(summary.description)).toBe(summary.description);
  });

  it('as demais falas da pessoa seguem junto, para um dado curto não se perder', () => {
    const summary = buildFallbackSummary({
      sector: 'Saúde',
      cardCategory: null,
      transcript: [
        { role: 'user', content: 'Preciso de acesso a um módulo do Sonner para o meu trabalho' },
        { role: 'assistant', content: 'Qual módulo?' },
        { role: 'user', content: 'Compras' },
      ],
      cannedMessages: [],
    });
    expect(summary.description).toContain('- Compras');
    expect(summary.description).not.toContain('- Preciso de acesso');
    expect(normalizeDescription(summary.description)).toBe(summary.description);
  });

  it('nome, setor e IP entram no início do Contexto, vindos do formulário', () => {
    const description = 'Problema identificado:\nX\n\nContexto:\nY\n\nComportamento observado:\nZ';
    expect(
      withRequesterContext(description, {
        requesterName: 'Maria',
        sector: 'Saúde',
        machineIp: '10.0.0.10',
      }),
    ).toContain('Contexto:\nSolicitante: Maria. Setor: Saúde. IP da máquina: 10.0.0.10.\nY');
    expect(
      withRequesterContext(description, {
        requesterName: 'Maria',
        sector: 'Saúde',
        machineIp: null,
      }),
    ).toContain('IP da máquina: não informado, pessoa sem acesso à máquina.');
  });

  it('o título da contingência nunca passa de 80 caracteres', () => {
    const summary = buildFallbackSummary({
      sector: 'S'.repeat(200),
      cardCategory: null,
      transcript: [],
      cannedMessages: [],
    });
    expect(summary.title).toHaveLength(80);
    expect(summary.category).toBe('Suporte técnico geral');
  });

  it('o modo teste não usa IA e tem título, categoria e urgência próprios', () => {
    const summary = buildTestSummary({ sector: 'Saúde', date: '02/03/2026' });
    expect(summary).toMatchObject({
      title: 'Chamado de teste',
      category: 'Teste',
      urgency: 1,
      source: 'test',
    });
    expect(summary.description).toBe(
      'Este é um chamado de teste aberto pelo ChicoChat+ em 02/03/2026 pelo setor Saúde.\n\nNenhuma ação é necessária — o chamado pode ser fechado.',
    );
  });
});

describe('texto do chamado no GLPI', () => {
  const base = {
    requesterName: 'Maria Silva',
    requesterEmail: 'maria@prefeitura.example.test',
    sector: 'Secretaria de Saúde',
    machineIp: '10.1.2.30',
    category: 'Rede e internet',
    onBehalf: false,
    beneficiaryName: null,
    beneficiaryRegistration: null,
    beneficiarySector: null,
    description: SECTIONS_TEXT,
    transcriptUrl: null,
  };

  it('segue o formato da seção G.4', () => {
    expect(buildTicketContent(base)).toBe(
      [
        '**Chamado aberto automaticamente pelo ChicoChat+**',
        '',
        '**Solicitante:** Maria Silva (maria@prefeitura.example.test)',
        '**Setor do solicitante:** Secretaria de Saúde',
        '**IP da máquina:** 10.1.2.30',
        '**Categoria:** Rede e internet',
        '',
        '---',
        '',
        SECTIONS_TEXT,
      ].join('\n'),
    );
  });

  it('com transcrição, termina com o link da conversa completa', () => {
    const text = buildTicketContent({
      ...base,
      transcriptUrl: 'https://chico.example.test/conversa/abc',
    });
    expect(
      text.endsWith(
        '---\n\n**Visualizar conversa completa:** https://chico.example.test/conversa/abc',
      ),
    ).toBe(true);
    expect(buildTicketContent(base)).not.toContain('Visualizar conversa');
  });

  it('sem IP, diz que o usuário não tem acesso à máquina', () => {
    expect(buildTicketContent({ ...base, machineIp: null })).toContain(
      '**IP da máquina:** Não informado — usuário sem acesso à máquina',
    );
  });

  it('em nome de outra pessoa, acrescenta o bloco do atendido, com matrícula só se houver', () => {
    const withReg = buildTicketContent({
      ...base,
      onBehalf: true,
      beneficiaryName: 'João Souza',
      beneficiaryRegistration: '12345',
      beneficiarySector: 'Obras',
    });
    expect(withReg).toContain(
      '### Atendimento solicitado para terceiro\n**Nome do atendido:** João Souza\n**Matrícula:** 12345\n**Unidade/Setor:** Obras',
    );
    const without = buildTicketContent({
      ...base,
      onBehalf: true,
      beneficiaryName: 'João Souza',
      beneficiarySector: 'Obras',
    });
    expect(without).not.toContain('Matrícula');
    expect(buildTicketContent(base)).not.toContain('terceiro');
  });
});

describe('duplicidade: limiares', () => {
  const NOW = new Date('2026-03-02T12:00:00.000Z');
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
  const current = (overrides: Partial<CurrentCase> = {}): CurrentCase => ({
    category: null,
    userMessages: ['alfa beta gama'],
    ...overrides,
  });
  const ticket = (overrides: Partial<PastTicket> = {}): PastTicket => ({
    ticketId: '100',
    userId: 'u1',
    title: 'alfa delta omega',
    summary: null,
    category: null,
    createdAt: minutesAgo(3 * 24 * 60),
    ...overrides,
  });

  it('tokeniza sem acento, sem palavras vazias e só com 3 ou mais caracteres', () => {
    expect(
      [...tokenize('Você está com a IMPRESSORA offline! Não imprime (HP-2020)')].sort(),
    ).toEqual(['2020', 'imprime', 'impressora', 'offline'].sort());
  });

  it('Jaccard: interseção sobre união', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });

  it('limiar pessoal de 0,18: 1/5 (0,20) entra e 1/6 (0,1667) não', () => {
    expect(
      findSimilarTickets(current(), [ticket({ title: 'alfa delta omega' })], NOW),
    ).toHaveLength(1);
    expect(
      findSimilarTickets(current(), [ticket({ title: 'alfa delta omega sigma' })], NOW),
    ).toHaveLength(0);
  });

  it('o texto do chamado inclui título, resumo e categoria', () => {
    const hits = findSimilarTickets(
      current(),
      [ticket({ title: 'delta', summary: 'alfa omega', category: 'sigma' })],
      NOW,
    );
    expect(hits).toHaveLength(0); // 1 em 6 tokens
    expect(
      findSimilarTickets(
        current({ userMessages: ['alfa beta'] }),
        [ticket({ title: 'delta', summary: 'alfa', category: 'sigma' })],
        NOW,
      ),
    ).toHaveLength(1); // 1 em 4 tokens: 0,25
  });

  it('bônus de recência nas últimas 2 h: +0,15 no instante zero, caindo até zero em 2 h', () => {
    const weak = { title: 'alfa delta omega sigma' }; // 0,1667: abaixo do limiar
    const at = (m: number) =>
      findSimilarTickets(current(), [ticket({ ...weak, createdAt: minutesAgo(m) })], NOW);
    expect(at(0)[0]?.score).toBeCloseTo(0.1667 + 0.15, 3);
    expect(at(60)[0]?.score).toBeCloseTo(0.1667 + 0.075, 3);
    expect(at(60)).toHaveLength(1);
    expect(at(119)).toHaveLength(0); // bônus de 0,00125: ainda abaixo de 0,18
    expect(at(120)).toHaveLength(0); // sem bônus
  });

  it('o bônus nunca passa de 1', () => {
    const [hit] = findSimilarTickets(
      current(),
      [ticket({ title: 'alfa beta gama', createdAt: minutesAgo(0) })],
      NOW,
    );
    expect(hit?.score).toBe(1);
  });

  it('regra forte: mesma categoria nas últimas 4 h entra sempre, com nota mínima de 0,55', () => {
    const cur = current({ category: 'Rede e internet', userMessages: ['xxxxx yyyyy'] });
    const same = (m: number) =>
      findSimilarTickets(
        cur,
        [ticket({ title: 'zzzzz kkkkk', category: 'Rede e internet', createdAt: minutesAgo(m) })],
        NOW,
      );
    expect(same(10)[0]?.score).toBeGreaterThanOrEqual(0.55);
    expect(same(240)[0]?.score).toBeGreaterThanOrEqual(0.55);
    // Passadas 4 h, só a semelhança de texto conta (aqui, as palavras da própria categoria).
    expect(same(241)[0]?.score).toBeLessThan(0.55);
    // Categoria diferente não dispara a regra.
    expect(
      findSimilarTickets(
        cur,
        [ticket({ title: 'zzzzz kkkkk', category: 'Outra coisa?', createdAt: minutesAgo(10) })],
        NOW,
      ),
    ).toHaveLength(0);
    // Conversa sem categoria também não.
    expect(
      findSimilarTickets(
        current({ userMessages: ['xxxxx yyyyy'] }),
        [ticket({ title: 'zzzzz', category: 'Rede e internet', createdAt: minutesAgo(10) })],
        NOW,
      ),
    ).toHaveLength(0);
  });

  it('no máximo 3, pelos maiores valores', () => {
    const past = ['alfa beta', 'alfa beta gama', 'alfa', 'alfa delta omega', 'alfa beta delta'].map(
      (title, i) => ticket({ ticketId: String(i), title }),
    );
    const hits = findSimilarTickets(current(), past, NOW);
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.ticketId)).toEqual(['1', '0', '4']);
  });

  it('devolve a idade em minutos', () => {
    const [hit] = findSimilarTickets(current(), [ticket({ createdAt: minutesAgo(90) })], NOW);
    expect(hit?.ageMinutes).toBe(90);
  });

  describe('incidente coletivo', () => {
    const cur = current({ userMessages: ['alfa beta gama delta'] });
    const others = (n: number, overrides: Partial<PastTicket> = {}) =>
      Array.from({ length: n }, (_, i) =>
        ticket({
          ticketId: `c${i}`,
          userId: `outro-${i}`,
          title: 'alfa beta gama',
          createdAt: minutesAgo(30),
          ...overrides,
        }),
      );

    it('3 usuários diferentes com relatos parecidos nas últimas 2 h', () => {
      expect(detectCollectiveIncident(cur, others(2), 'eu', NOW)).toBeNull();
      expect(detectCollectiveIncident(cur, others(3), 'eu', NOW)).toEqual({
        count: 3,
        category: null,
        windowHours: 2,
      });
    });

    it('conta usuários distintos: três chamados do mesmo usuário não bastam', () => {
      const same = others(3).map((t) => ({ ...t, userId: 'outro-0' }));
      expect(detectCollectiveIncident(cur, same, 'eu', NOW)).toBeNull();
    });

    it('os chamados do próprio usuário não contam', () => {
      const mine = others(3).map((t) => ({ ...t, userId: 'eu' }));
      expect(detectCollectiveIncident(cur, mine, 'eu', NOW)).toBeNull();
      expect(detectCollectiveIncident(cur, [...others(2), ...mine], 'eu', NOW)).toBeNull();
    });

    it('janela de 2 h: 120 min ainda conta, 121 não', () => {
      expect(
        detectCollectiveIncident(cur, others(3, { createdAt: minutesAgo(120) }), 'eu', NOW)?.count,
      ).toBe(3);
      expect(
        detectCollectiveIncident(cur, others(3, { createdAt: minutesAgo(121) }), 'eu', NOW),
      ).toBeNull();
    });

    it('limiar de 0,28: 2/7 (0,2857) conta e 1/4 (0,25) não', () => {
      // atual: alfa beta gama delta (4). Chamado com alfa beta + 3 palavras: 2 em 7.
      expect(
        detectCollectiveIncident(
          cur,
          others(3, { title: 'alfa beta sigma kappa omega' }),
          'eu',
          NOW,
        ),
      ).not.toBeNull();
      // 1 em 7: abaixo.
      expect(
        detectCollectiveIncident(
          cur,
          others(3, { title: 'alfa sigma kappa omega epsilon zeta' }),
          'eu',
          NOW,
        ),
      ).toBeNull();
    });

    it('usa só título e categoria do chamado, não o resumo', () => {
      expect(
        detectCollectiveIncident(
          cur,
          others(3, { title: 'sigma', summary: 'alfa beta gama delta' }),
          'eu',
          NOW,
        ),
      ).toBeNull();
    });

    it('devolve só contagem e categoria, nunca títulos de outras pessoas', () => {
      const result = detectCollectiveIncident(
        cur,
        others(3, { title: 'alfa beta gama SEGREDO-ALHEIO' }),
        'eu',
        NOW,
      );
      expect(JSON.stringify(result)).not.toContain('SEGREDO-ALHEIO');
    });
  });
});
