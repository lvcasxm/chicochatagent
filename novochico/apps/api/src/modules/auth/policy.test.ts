import { describe, expect, it } from 'vitest';
import type { GoogleIdentityClaims } from '../../integrations/google/oidc';
import { evaluateIdentity } from './policy';

const ALLOWED = ['prefeitura.example.test'];

const VALID: GoogleIdentityClaims = {
  sub: 'google-1',
  email: 'fulano@prefeitura.example.test',
  emailVerified: true,
  hostedDomain: 'prefeitura.example.test',
  name: 'Fulano de Tal',
};

function reasonFor(claims: Partial<GoogleIdentityClaims>, allowed: readonly string[] = ALLOWED) {
  const decision = evaluateIdentity({ ...VALID, ...claims }, allowed);
  if (decision.ok) throw new Error('A identidade deveria ter sido recusada.');
  return decision.reason;
}

describe('política de identidade', () => {
  it('aceita uma conta institucional verificada', () => {
    expect(evaluateIdentity(VALID, ALLOWED)).toEqual({
      ok: true,
      identity: {
        googleSub: 'google-1',
        email: 'fulano@prefeitura.example.test',
        fullName: 'Fulano de Tal',
      },
    });
  });

  it('normaliza o e-mail para minúsculas e ignora espaços', () => {
    const decision = evaluateIdentity(
      { ...VALID, email: '  Fulano@Prefeitura.EXAMPLE.test ' },
      ALLOWED,
    );
    expect(decision).toMatchObject({
      ok: true,
      identity: { email: 'fulano@prefeitura.example.test' },
    });
  });

  it('usa a parte local do e-mail quando o Google não envia o nome', () => {
    for (const name of [undefined, '', '   ']) {
      const decision = evaluateIdentity({ ...VALID, name }, ALLOWED);
      expect(decision).toMatchObject({ ok: true, identity: { fullName: 'fulano' } });
    }
  });

  describe('domínio do e-mail', () => {
    it('recusa um domínio que não está na lista', () => {
      expect(reasonFor({ email: 'fulano@gmail.com' })).toBe('domain');
    });

    it('compara o domínio inteiro, nunca por sufixo ou prefixo', () => {
      for (const email of [
        'fulano@evilprefeitura.example.test',
        'fulano@prefeitura.example.test.evil.com',
        'fulano@sub.prefeitura.example.test',
        'fulano@xprefeitura.example.test',
      ]) {
        expect(reasonFor({ email }), email).toBe('domain');
      }
    });

    it('recusa e-mails com forma ambígua', () => {
      for (const email of [
        'fulano@evil.com@prefeitura.example.test',
        '@prefeitura.example.test',
        'fulano@',
        'fulano',
      ]) {
        expect(reasonFor({ email }), email).toBe('domain');
      }
    });

    it('aceita qualquer um dos vários domínios permitidos', () => {
      const allowed = ['prefeitura.example.test', 'outro.example.test'];
      const decision = evaluateIdentity(
        { ...VALID, email: 'a@outro.example.test', hostedDomain: 'outro.example.test' },
        allowed,
      );
      expect(decision.ok).toBe(true);
    });
  });

  describe('domínio do Workspace (hd)', () => {
    it('recusa conta pessoal, sem hd, mesmo com e-mail de um domínio permitido', () => {
      expect(reasonFor({ hostedDomain: undefined })).toBe('domain');
    });

    it('recusa hd de um domínio que não está na lista', () => {
      expect(reasonFor({ hostedDomain: 'outra-prefeitura.example.test' })).toBe('domain');
    });

    it('aceita e-mail de domínio-alias quando o hd é outro domínio permitido', () => {
      const allowed = ['prefeitura.example.test', 'alias.example.test'];
      const decision = evaluateIdentity(
        { ...VALID, email: 'fulano@alias.example.test', hostedDomain: 'prefeitura.example.test' },
        allowed,
      );
      expect(decision.ok).toBe(true);
    });
  });

  describe('e-mail verificado', () => {
    it('recusa e-mail não verificado', () => {
      expect(reasonFor({ emailVerified: false })).toBe('unverified');
    });

    it('recusa quando o Google não envia e-mail', () => {
      expect(reasonFor({ email: undefined })).toBe('unverified');
      expect(reasonFor({ email: '   ' })).toBe('unverified');
    });
  });

  it('verifica o domínio antes da verificação, para não confundir quem usa outra conta', () => {
    expect(reasonFor({ email: 'fulano@gmail.com', emailVerified: false })).toBe('domain');
  });

  it('recusa tudo quando a lista de domínios está vazia', () => {
    expect(reasonFor({}, [])).toBe('domain');
  });
});
