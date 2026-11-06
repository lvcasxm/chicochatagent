import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvLine } from './csv';

describe('csvCell', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+55 31 99999', "'+55 31 99999"],
    ['-2', "'-2"],
    ['@usuario', "'@usuario"],
    ['\tcom tab', "'\tcom tab"],
    ['\rcom retorno', `"'\rcom retorno"`],
    ['=HYPERLINK("x";"y")', `"'=HYPERLINK(""x"";""y"")"`],
  ])('protege %j contra fórmula', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('mantém o texto comum e só cita o que precisa', () => {
    expect(csvCell('texto simples')).toBe('texto simples');
    expect(csvCell('com;ponto e vírgula')).toBe('"com;ponto e vírgula"');
    expect(csvCell('com "aspas"')).toBe('"com ""aspas"""');
    expect(csvCell('duas\nlinhas')).toBe('"duas\nlinhas"');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('3 - 2')).toBe('3 - 2');
  });

  it('números, booleanos, nulos e datas', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(true)).toBe('sim');
    expect(csvCell(false)).toBe('não');
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-03-02T12:00:00Z'))).toBe('2026-03-02T12:00:00.000Z');
  });

  it('a linha termina em CRLF e usa ";"', () => {
    expect(csvLine(['a', 1, null, 'b;c'])).toBe('a;1;;"b;c"\r\n');
    expect(CSV_BOM).toBe('﻿');
  });
});
