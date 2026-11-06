import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('aceita caminhos do próprio sistema, com query e âncora', () => {
    expect(safeRedirectPath('/')).toBe('/');
    expect(safeRedirectPath('/c/123')).toBe('/c/123');
    expect(safeRedirectPath('/admin/conversas?periodo=7d#topo')).toBe(
      '/admin/conversas?periodo=7d#topo',
    );
  });

  it('volta para a página inicial quando não há destino', () => {
    for (const input of [undefined, null, '', 42, {}, ['/a'], true]) {
      expect(safeRedirectPath(input), typeof input).toBe('/');
    }
  });

  it('recusa endereços completos e de outros sites', () => {
    for (const input of [
      'https://evil.test',
      'http://evil.test/c/1',
      '//evil.test',
      '//evil.test/c/1',
      'evil.test/c/1',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      expect(safeRedirectPath(input), input).toBe('/');
    }
  });

  it('recusa truques com barra invertida, que alguns navegadores tratam como barra', () => {
    for (const input of ['/\\evil.test', '/\\/evil.test', '\\\\evil.test', '/c/1\\..\\x']) {
      expect(safeRedirectPath(input), input).toBe('/');
    }
  });

  it('recusa caracteres de controle, inclusive quebras de linha e tabulação', () => {
    for (const input of [
      '/c/1\r\nSet-Cookie: x=1',
      '/c/\n1',
      '/c/\t1',
      '/c/\u00001',
      '/\t/evil.test',
    ]) {
      expect(safeRedirectPath(input), JSON.stringify(input)).toBe('/');
    }
  });

  it('recusa destinos muito longos', () => {
    expect(safeRedirectPath(`/${'a'.repeat(512)}`)).toBe('/');
    expect(safeRedirectPath(`/${'a'.repeat(100)}`)).toBe(`/${'a'.repeat(100)}`);
  });

  it('não volta para a tela de login nem para a própria API', () => {
    for (const input of ['/login', '/login?error=domain', '/api/auth/google', '/api/me']) {
      expect(safeRedirectPath(input), input).toBe('/');
    }
  });

  it('normaliza o caminho, resolvendo "." e ".." sem sair do sistema', () => {
    expect(safeRedirectPath('/a/../b')).toBe('/b');
    expect(safeRedirectPath('/../../c')).toBe('/c');
    expect(safeRedirectPath('/a/./b')).toBe('/a/b');
  });
});
