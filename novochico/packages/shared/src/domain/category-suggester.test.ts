import { describe, expect, it } from 'vitest';
import { suggestCategoryKey } from './category-suggester';

describe('suggestCategoryKey', () => {
  it.each([
    ['acho que é um vírus no computador', 'security'],
    ['recebi um link suspeito', 'security'],
    ['o papel atolou na impressora', null], // "atolou" sozinho não é termo; veja o caso abaixo
    ['papel atolado na impressora', 'printer'],
    ['preciso trocar o toner', 'printer'],
    ['erro no sonner ao salvar', 'grp'],
    ['preciso instalar um programa', 'install'],
    ['não consigo entrar no SEI', 'sei'],
    ['esqueci a senha do meu usuário', 'password'],
    ['meu e-mail não envia', 'email'],
    ['o outlook não abre', 'email'],
    ['o wi-fi está caindo', 'network'],
    ['a internet está lenta', 'network'],
    ['o computador está travando', 'hardware'],
  ])('"%s" sugere %s', (text, expected) => {
    expect(suggestCategoryKey(text)).toBe(expected);
  });

  it('segurança tem prioridade sobre os demais assuntos', () => {
    expect(suggestCategoryKey('meu e-mail recebeu um anexo suspeito')).toBe('security');
  });

  it('casos físicos de impressora vêm antes de "instalar"', () => {
    expect(suggestCategoryKey('preciso instalar um toner novo, o toner acabou')).toBe('printer');
  });

  it('só casa palavra inteira, nunca parte de palavra (B-03)', () => {
    expect(suggestCategoryKey('falar com o Seixas amanhã')).toBeNull();
    expect(suggestCategoryKey('o pedreiro chegou cedo')).toBeNull();
    expect(suggestCategoryKey('grupo de trabalho novo')).toBeNull();
    expect(suggestCategoryKey('arquivo de loginfo antigo')).toBeNull();
  });

  it('exige pelo menos 6 caracteres', () => {
    expect(suggestCategoryKey('senha')).toBeNull();
    expect(suggestCategoryKey('  sei  ')).toBeNull();
    expect(suggestCategoryKey('senha x')).toBe('password');
  });

  it('ignora acentos, caixa e pontuação', () => {
    expect(suggestCategoryKey('VÍRUS!!! no PC')).toBe('security');
    expect(suggestCategoryKey('Esqueci, a. senha...')).toBe('password');
  });

  it('texto vazio ou sem assunto conhecido não sugere nada', () => {
    expect(suggestCategoryKey('')).toBeNull();
    expect(suggestCategoryKey('bom dia, tudo bem com você?')).toBeNull();
  });
});
