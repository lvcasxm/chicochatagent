import { describe, expect, it } from 'vitest';
import { createMarkerFilter, detectMarkers, stripMarkers, tidy } from './stream-filter';

/** Alimenta o filtro com os trechos e junta tudo o que ele deixou sair, mais o final. */
function run(chunks: string[]) {
  const filter = createMarkerFilter();
  let streamed = '';
  const pieces: string[] = [];
  for (const chunk of chunks) {
    const out = filter.push(chunk);
    pieces.push(out);
    streamed += out;
  }
  const done = filter.finish();
  streamed += done.rest;
  return { streamed, final: done.text, markers: done.markers, pieces };
}

/** Divide o texto em todos os pontos possíveis e em trechos de 1, 2, 3 e 7 caracteres. */
function splits(text: string): string[][] {
  const result: string[][] = [[text]];
  for (let i = 1; i < text.length; i++) result.push([text.slice(0, i), text.slice(i)]);
  for (const size of [1, 2, 3, 7]) {
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
    result.push(parts);
  }
  return result;
}

const MARKER_FORMS = [
  '<<OPEN_TICKET_FORM>>',
  '<<RESOLUTION_ATTEMPT>>',
  '`<<OPEN_TICKET_FORM>>`',
  '`<<RESOLUTION_ATTEMPT>>`',
  '<OPEN_TICKET_FORM>',
  '<RESOLUTION_ATTEMPT>',
  '<<OPEN_TICKET_FORM',
  '<<OPEN_TICKET_FORM>',
  '<< OPEN_TICKET_FORM >>',
  '<<open_ticket_form>>',
  '<<Resolution_Attempt>>',
];

describe('stripMarkers', () => {
  it.each(MARKER_FORMS)('remove a variante %s', (marker) => {
    expect(stripMarkers(`Oi\n${marker}`).trim()).toBe('Oi');
  });

  it('remove a palavra isolada em uma linha, com decoração de markdown', () => {
    expect(tidy(stripMarkers('Texto\n- RESOLUTION_ATTEMPT\nFim'))).toBe('Texto\n\nFim');
    expect(tidy(stripMarkers('Texto\n> **OPEN_TICKET_FORM**'))).toBe('Texto');
    expect(tidy(stripMarkers('Texto\n__OPEN_TICKET_FORM__'))).toBe('Texto');
  });

  it('remove a palavra solta no meio da frase', () => {
    expect(stripMarkers('antes RESOLUTION_ATTEMPT depois')).toBe('antes  depois');
  });

  it('não mexe em texto comum', () => {
    const text =
      'Reinicie o computador e **tente de novo**. O sistema <b>não</b> deve mudar: a > b.';
    expect(stripMarkers(text)).toBe(text);
  });
});

describe('tidy', () => {
  it('troca três ou mais quebras por duas e apara as pontas', () => {
    expect(tidy('\n\n a\n\n\n\n b \n\n')).toBe('a\n\n b');
  });
});

describe('detectMarkers', () => {
  it('vê cada marcador, em qualquer variante', () => {
    expect(detectMarkers('x `<<RESOLUTION_ATTEMPT>>`')).toEqual({
      resolutionAttempt: true,
      openTicketForm: false,
    });
    expect(detectMarkers('<open_ticket_form>')).toEqual({
      resolutionAttempt: false,
      openTicketForm: true,
    });
    expect(detectMarkers('nada')).toEqual({ resolutionAttempt: false, openTicketForm: false });
  });
});

describe('createMarkerFilter: marcador partido em todos os pontos', () => {
  const PREFIX = 'Tente reiniciar o computador.\n\n';

  describe.each(MARKER_FORMS)('variante %s', (marker) => {
    const text = `${PREFIX}${marker}`;
    const expected = tidy(stripMarkers(text));

    it('nenhum marcador chega ao navegador, qualquer que seja a divisão dos trechos', () => {
      for (const chunks of splits(text)) {
        const { streamed, final } = run(chunks);
        const where = JSON.stringify(chunks);
        expect(streamed, where).not.toMatch(/RESOLUTION_ATTEMPT|OPEN_TICKET_FORM/i);
        expect(streamed, where).not.toMatch(/<</);
        expect(final, where).toBe(expected);
        // O que saiu em trechos e o texto final são o mesmo (a menos de espaço nas pontas).
        expect(streamed.trim(), where).toBe(expected);
      }
    });

    it('o marcador é detectado no texto bruto', () => {
      const { markers } = run(splits(text)[3] ?? [text]);
      expect(markers.resolutionAttempt || markers.openTicketForm).toBe(true);
    });
  });

  it('marcador no meio do texto, entre frases', () => {
    const text = 'Primeiro.\n<<RESOLUTION_ATTEMPT>>\nDepois.';
    for (const chunks of splits(text)) {
      const { streamed, final } = run(chunks);
      expect(streamed).not.toMatch(/RESOLUTION_ATTEMPT/);
      expect(final).toBe('Primeiro.\n\nDepois.');
      expect(streamed.replace(/\s+/g, ' ').trim()).toBe('Primeiro. Depois.');
    }
  });

  it('os dois marcadores na mesma resposta', () => {
    const text = 'Vou abrir um chamado.\n<<RESOLUTION_ATTEMPT>>\n<<OPEN_TICKET_FORM>>';
    for (const chunks of splits(text)) {
      const { streamed, markers } = run(chunks);
      expect(streamed).not.toMatch(/RESOLUTION_ATTEMPT|OPEN_TICKET_FORM/);
      expect(markers).toEqual({ resolutionAttempt: true, openTicketForm: true });
    }
  });

  it('texto sem marcador passa inteiro, em qualquer divisão', () => {
    const text =
      'Reinicie o **Outlook** e veja se o `erro 5` some.\n\n- passo a\n- passo b\n\nO problema continua?';
    for (const chunks of splits(text)) {
      const { streamed, final } = run(chunks);
      expect(final).toBe(text);
      expect(streamed.trim()).toBe(text);
    }
  });

  it('não segura o texto à toa: o que não pode virar marcador sai logo', () => {
    const filter = createMarkerFilter();
    expect(filter.push('Olá, tudo bem? ')).toBe('Olá, tudo bem? ');
    expect(filter.push('Vamos ver o problema.')).toBe('Vamos ver o problema.');
  });

  it('retém só o final que ainda pode virar marcador e o libera quando deixa de poder', () => {
    const filter = createMarkerFilter();
    expect(filter.push('Passo 1.\n<<RESOL')).toBe('Passo 1.\n');
    expect(filter.push('UTION_AT')).toBe('');
    // "<<RESOLUTION_ATOMIC" não é um marcador: o que estava retido sai.
    expect(filter.push('OMIC')).toBe('<<RESOLUTION_ATOMIC');
  });

  it('no fim do stream, descarta o fragmento de marcador que ficou retido', () => {
    const filter = createMarkerFilter();
    filter.push('Resposta curta <<RES');
    const done = filter.finish();
    // O fragmento "<<RES" retido no fim é de um marcador cortado e não faz parte do texto.
    expect(done.text).toBe('Resposta curta');
    expect(done.markers).toEqual({ resolutionAttempt: false, openTicketForm: false });
  });

  it('em resposta interrompida no meio do marcador, ele não aparece', () => {
    const { streamed, final, markers } = run(['Tente isso.\n<<OPEN_TICKET_', 'FO']);
    expect(streamed).not.toMatch(/OPEN_TICKET/);
    expect(final).toBe('Tente isso.');
    // Um marcador cortado não vale: o servidor não o processa.
    expect(markers.openTicketForm).toBe(false);
  });

  it('um "<" comum, como em "a < b", não prende o texto depois dele', () => {
    const filter = createMarkerFilter();
    expect(filter.push('Se a ')).toBe('Se a ');
    expect(filter.push('< b então ')).toBe('< b então ');
  });
});
