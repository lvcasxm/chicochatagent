import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeOidc, type FakeIdentity, type FakeOidc } from '../../../test/fake-oidc';
import { createGoogleOidcClient, OidcError, type GoogleOidcClient } from './oidc';

const REDIRECT_URI = 'http://127.0.0.1:5173/api/auth/google/callback';

const IDENTITY: FakeIdentity = {
  sub: 'google-123',
  email: 'fulano@prefeitura.example.test',
  email_verified: true,
  hd: 'prefeitura.example.test',
  name: 'Fulano de Tal',
};

describe('cliente OIDC do Google (contra um provedor local)', () => {
  let fake: FakeOidc;
  let oidc: GoogleOidcClient;

  beforeAll(async () => {
    fake = await startFakeOidc();
    oidc = createGoogleOidcClient({
      clientId: fake.clientId,
      clientSecret: fake.clientSecret,
      hostedDomain: 'prefeitura.example.test',
      issuer: fake.issuer,
      allowInsecure: true,
    });
  });

  afterAll(async () => {
    await fake.close();
  });

  /** Percorre o login inteiro, como o navegador faria, e devolve o que o servidor concluiu. */
  async function login(
    identity: FakeIdentity,
    tamper?: Parameters<FakeOidc['approve']>[2],
    mutate?: (callback: URL) => void,
  ) {
    const { url, transaction } = await oidc.createAuthorizationRequest({
      redirectUri: REDIRECT_URI,
    });
    const callback = await fake.approve(url, identity, tamper);
    mutate?.(callback);
    return oidc.completeLogin({ currentUrl: callback, transaction });
  }

  describe('pedido de autorização', () => {
    it('usa o fluxo de código com PKCE S256, state, nonce e os escopos mínimos', async () => {
      const { url, transaction } = await oidc.createAuthorizationRequest({
        redirectUri: REDIRECT_URI,
      });
      const params = url.searchParams;
      expect(url.origin + url.pathname).toBe(`${fake.issuer.origin}/authorize`);
      expect(params.get('response_type')).toBe('code');
      expect(params.get('client_id')).toBe(fake.clientId);
      expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
      expect(params.get('scope')).toBe('openid email profile');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('code_challenge')).toBe(
        createHash('sha256').update(transaction.codeVerifier).digest('base64url'),
      );
      expect(params.get('state')).toBe(transaction.state);
      expect(params.get('nonce')).toBe(transaction.nonce);
      expect(params.get('prompt')).toBe('select_account');
      expect(params.get('hd')).toBe('prefeitura.example.test');
    });

    it('gera valores aleatórios diferentes a cada pedido', async () => {
      const first = await oidc.createAuthorizationRequest({ redirectUri: REDIRECT_URI });
      const second = await oidc.createAuthorizationRequest({ redirectUri: REDIRECT_URI });
      expect(first.transaction.state).not.toBe(second.transaction.state);
      expect(first.transaction.nonce).not.toBe(second.transaction.nonce);
      expect(first.transaction.codeVerifier).not.toBe(second.transaction.codeVerifier);
    });

    it('não envia a dica de domínio quando ela não foi configurada', async () => {
      const semDica = createGoogleOidcClient({
        clientId: fake.clientId,
        clientSecret: fake.clientSecret,
        issuer: fake.issuer,
        allowInsecure: true,
      });
      const { url } = await semDica.createAuthorizationRequest({ redirectUri: REDIRECT_URI });
      expect(url.searchParams.has('hd')).toBe(false);
    });
  });

  describe('conclusão do login', () => {
    it('devolve as afirmações do Google com os tipos conferidos', async () => {
      await expect(login(IDENTITY)).resolves.toEqual({
        sub: 'google-123',
        email: 'fulano@prefeitura.example.test',
        emailVerified: true,
        hostedDomain: 'prefeitura.example.test',
        name: 'Fulano de Tal',
      });
    });

    it('trata e-mail_verified diferente do booleano true como não verificado', async () => {
      for (const value of ['true', 'sim', 1 as unknown as boolean, undefined]) {
        const claims = await login({ ...IDENTITY, email_verified: value });
        expect(claims.emailVerified, String(value)).toBe(false);
      }
    });

    it('deixa de fora afirmações ausentes em vez de inventá-las', async () => {
      const claims = await login({ sub: 'sem-detalhes' });
      expect(claims).toEqual({
        sub: 'sem-detalhes',
        email: undefined,
        emailVerified: false,
        hostedDomain: undefined,
        name: undefined,
      });
    });

    it('rejeita um state diferente do enviado', async () => {
      const result = login(IDENTITY, { state: 'state-forjado' });
      await expect(result).rejects.toMatchObject({ name: 'OidcError', failure: 'rejected' });
    });

    it('rejeita um nonce diferente do enviado', async () => {
      const result = login(IDENTITY, { nonce: 'nonce-de-outro-login' });
      await expect(result).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita um id_token emitido para outro cliente', async () => {
      const result = login(IDENTITY, { audience: 'outro-cliente' });
      await expect(result).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita um id_token de outro emissor', async () => {
      const result = login(IDENTITY, { issuer: 'https://emissor-falso.example.test' });
      await expect(result).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita um id_token vencido', async () => {
      const result = login(IDENTITY, { expiresInSeconds: -3600 });
      await expect(result).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita um id_token assinado por uma chave desconhecida', async () => {
      const result = login(IDENTITY, { signWithUnknownKey: true });
      await expect(result).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita quando o verificador PKCE não corresponde ao desafio', async () => {
      const { url, transaction } = await oidc.createAuthorizationRequest({
        redirectUri: REDIRECT_URI,
      });
      const callback = await fake.approve(url, IDENTITY);
      const result = oidc.completeLogin({
        currentUrl: callback,
        transaction: {
          ...transaction,
          codeVerifier: 'verificador-de-outro-login-'.padEnd(43, 'x'),
        },
      });
      await expect(result).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita reutilizar o mesmo código de autorização', async () => {
      const { url, transaction } = await oidc.createAuthorizationRequest({
        redirectUri: REDIRECT_URI,
      });
      const callback = await fake.approve(url, IDENTITY);
      await oidc.completeLogin({ currentUrl: callback, transaction });
      await expect(oidc.completeLogin({ currentUrl: callback, transaction })).rejects.toMatchObject(
        {
          failure: 'rejected',
        },
      );
    });

    it('rejeita quando o provedor recusa o código', async () => {
      fake.rejectNextTokenRequest();
      await expect(login(IDENTITY)).rejects.toMatchObject({ failure: 'rejected' });
    });

    it('rejeita a volta sem código de autorização', async () => {
      const { transaction } = await oidc.createAuthorizationRequest({ redirectUri: REDIRECT_URI });
      const callback = new URL(REDIRECT_URI);
      callback.searchParams.set('state', transaction.state);
      await expect(oidc.completeLogin({ currentUrl: callback, transaction })).rejects.toMatchObject(
        {
          failure: 'rejected',
        },
      );
    });
  });

  describe('provedor fora do ar', () => {
    it('informa indisponibilidade, sem derrubar nada, e tenta de novo depois', async () => {
      const foraDoAr = createGoogleOidcClient({
        clientId: 'x',
        clientSecret: 'y',
        // Porta 1: nada escuta lá.
        issuer: new URL('http://127.0.0.1:1'),
        allowInsecure: true,
      });
      const first = await foraDoAr
        .createAuthorizationRequest({ redirectUri: REDIRECT_URI })
        .catch((e: unknown) => e);
      expect(first).toBeInstanceOf(OidcError);
      expect(first).toMatchObject({ failure: 'unavailable' });

      // Não ficou preso em um resultado de falha guardado: a segunda tentativa também tenta.
      const second = await foraDoAr
        .createAuthorizationRequest({ redirectUri: REDIRECT_URI })
        .catch((e: unknown) => e);
      expect(second).toMatchObject({ failure: 'unavailable' });
    }, 30_000);
  });
});
