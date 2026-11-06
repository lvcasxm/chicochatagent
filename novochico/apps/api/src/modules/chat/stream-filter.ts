/**
 * Filtro dos marcadores de controle no stream (RF-022, H.4). A IA escreve `<<RESOLUTION_ATTEMPT>>`
 * e `<<OPEN_TICKET_FORM>>` no texto; eles nunca podem chegar ao navegador nem ser gravados, mesmo
 * quando partidos entre trechos ou em variantes (crases, um só `<`, palavra isolada na linha).
 *
 * Duas decisões:
 *  - o texto só sai depois de passar por `strip`, e o final de cada trecho que ainda pode virar
 *    um marcador fica retido até o próximo;
 *  - os marcadores são detectados no texto bruto completo, não no que sobrou.
 */

const MARKER_WORDS = ['RESOLUTION_ATTEMPT', 'OPEN_TICKET_FORM'] as const;

/** Variantes vistas no sistema anterior (AgentChat.tsx), na mesma ordem. */
const STRIP_PATTERNS: readonly RegExp[] = [
  /`?<<?\s*OPEN_TICKET_FORM\s*>?>?`?/gi,
  /`?<<?\s*RESOLUTION_ATTEMPT\s*>?>?`?/gi,
  /^[ \t>*_-]*RESOLUTION_ATTEMPT[ \t>*_-]*$/gim,
  /^[ \t>*_-]*OPEN_TICKET_FORM[ \t>*_-]*$/gim,
  /\bRESOLUTION_ATTEMPT\b/gi,
  /\bOPEN_TICKET_FORM\b/gi,
];

export function stripMarkers(text: string): string {
  return STRIP_PATTERNS.reduce((current, pattern) => current.replace(pattern, ''), text);
}

/** Depois do filtro: três ou mais quebras viram duas, e as pontas são aparadas. */
export function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export interface SeenMarkers {
  resolutionAttempt: boolean;
  openTicketForm: boolean;
}

export function detectMarkers(raw: string): SeenMarkers {
  return {
    resolutionAttempt: /RESOLUTION_ATTEMPT/i.test(raw),
    openTicketForm: /OPEN_TICKET_FORM/i.test(raw),
  };
}

/** Quanto do fim do texto ainda observamos em busca de um marcador incompleto. */
const LOOKBACK = 64;

/**
 * Este final de texto ainda pode se tornar um marcador? Formato:
 * decoração de linha, crase, `<` ou `<<`, a palavra (parcial ou inteira) e o fechamento.
 */
function mayBecomeMarker(tail: string, atLineStart: boolean, atWordBoundary: boolean): boolean {
  const match = /^([ \t>*_-]*)(`?)(<{0,2})\s*([A-Za-z_]*)(\s*)(>{0,2})(`?)$/.exec(tail);
  if (!match) return false;
  const [
    ,
    decoration = '',
    openTick = '',
    openAngles = '',
    word = '',
    gap = '',
    closeAngles = '',
    closeTick = '',
  ] = match;

  if (word === '') {
    // Só decoração no começo da linha (podia ser "- RESOLUTION..."), ou já um `<`/crase aberto.
    return (decoration !== '' && atLineStart) || openTick !== '' || openAngles !== '';
  }
  if (!atWordBoundary && decoration === '' && openTick === '' && openAngles === '') return false;

  const upper = word.toUpperCase();
  const isPrefix = MARKER_WORDS.some((marker) => marker.startsWith(upper) && marker !== upper);
  // Uma palavra parcial seguida de espaço já não vira marcador (que não tem espaço dentro).
  if (isPrefix) return gap === '' && closeAngles === '' && closeTick === '';

  const isComplete = MARKER_WORDS.some((marker) => marker === upper);
  if (!isComplete) return false;
  // Palavra inteira: ainda pode vir mais `>` ou a crase de fechamento.
  const stillOpen =
    (openAngles !== '' && closeAngles.length < 2) || (openTick !== '' && closeTick === '');
  return stillOpen || (openAngles === '' && openTick === '' && closeAngles === '');
}

/** Quantos caracteres do fim de `raw` devem ficar retidos. */
function holdbackLength(raw: string): number {
  const from = Math.max(0, raw.length - LOOKBACK);
  for (let i = from; i < raw.length; i++) {
    const atLineStart = i === 0 || raw[i - 1] === '\n';
    const atWordBoundary = i === 0 || !/[A-Za-z0-9_]/.test(raw[i - 1] ?? '');
    if (mayBecomeMarker(raw.slice(i), atLineStart, atWordBoundary)) return raw.length - i;
  }
  return 0;
}

export interface MarkerFilter {
  /** Recebe um trecho bruto; devolve o texto novo já seguro para enviar (pode ser vazio). */
  push(chunk: string): string;
  /** Fim do stream: devolve o que faltava enviar e o texto final que deve ser gravado. */
  finish(): { rest: string; text: string; markers: SeenMarkers };
  /** Marcadores já vistos até agora no texto bruto. */
  markers(): SeenMarkers;
}

export function createMarkerFilter(): MarkerFilter {
  let raw = '';
  let emitted = '';

  const emittable = (): string => {
    const safe = raw.slice(0, raw.length - holdbackLength(raw));
    return stripMarkers(safe);
  };

  return {
    push(chunk) {
      raw += chunk;
      const cleaned = emittable();
      // O texto limpo só cresce; se algo recuar, espera o próximo trecho em vez de reenviar.
      if (!cleaned.startsWith(emitted)) return '';
      const delta = cleaned.slice(emitted.length);
      emitted = cleaned;
      return delta;
    },
    finish() {
      // Resposta cortada no meio de um marcador: o fragmento (com `<`, crase ou `_`) não é texto.
      const held = holdbackLength(raw);
      const tail = raw.slice(raw.length - held);
      const visible = held > 0 && /[<`_]/.test(tail) ? raw.slice(0, raw.length - held) : raw;
      const text = tidy(stripMarkers(visible));
      const rest = text.startsWith(emitted) ? text.slice(emitted.length) : '';
      emitted = text.startsWith(emitted) ? text : emitted;
      return { rest, text, markers: detectMarkers(raw) };
    },
    markers: () => detectMarkers(raw),
  };
}
