import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

/**
 * Provedor OpenID Connect falso, só para testes. Sobe um servidor local, assina os id_tokens
 * com uma chave RSA gerada na hora e confere o PKCE de verdade. Assim, os testes exercitam o
 * `openid-client` real, e não um dublê dele: state, nonce, assinatura, emissor, destinatário
 * e validade são validados pela mesma biblioteca que roda em produção.
 */

export interface FakeIdentity {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  hd?: string;
  name?: string;
}

/** Defeitos que um provedor malicioso ou com erro poderia introduzir. */
export interface Tamper {
  nonce?: string;
  state?: string;
  audience?: string;
  issuer?: string;
  /** Segundos até expirar; negativo gera um token já vencido. */
  expiresInSeconds?: number;
  /** Assina com uma chave que não está no JWKS publicado. */
  signWithUnknownKey?: boolean;
}

export interface FakeOidc {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  /** Parâmetros do último pedido de autorização aprovado, para conferir o que o cliente enviou. */
  lastAuthorization(): URLSearchParams | undefined;
  /** Simula o usuário aprovando o login. Devolve o endereço de volta, com `code` e `state`. */
  approve(authorizationUrl: URL, identity: FakeIdentity, tamper?: Tamper): Promise<URL>;
  /** Faz o próximo pedido ao endpoint de token falhar, como um código recusado. */
  rejectNextTokenRequest(): void;
  tokenRequestCount(): number;
  close(): Promise<void>;
}

interface IssuedCode {
  idToken: string;
  codeChallenge: string;
  redirectUri: string;
  used: boolean;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function startFakeOidc(
  options: { clientId?: string; clientSecret?: string } = {},
): Promise<FakeOidc> {
  const clientId = options.clientId ?? 'cliente-de-teste';
  const clientSecret = options.clientSecret ?? 'segredo-de-teste';

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: 'chave-1',
    alg: 'RS256',
    use: 'sig',
  };

  const codes = new Map<string, IssuedCode>();
  let issuerUrl = '';
  let lastAuthorization: URLSearchParams | undefined;
  let tokenRequests = 0;
  let rejectNext = false;

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', issuerUrl);
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };

      if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        return send(200, {
          issuer: issuerUrl,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/token`,
          jwks_uri: `${issuerUrl}/jwks.json`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          code_challenge_methods_supported: ['S256'],
        });
      }

      if (request.method === 'GET' && url.pathname === '/jwks.json') {
        return send(200, { keys: [publicJwk] });
      }

      if (request.method === 'POST' && url.pathname === '/token') {
        tokenRequests += 1;
        const form = new URLSearchParams(await readBody(request));
        if (rejectNext) {
          rejectNext = false;
          return send(400, { error: 'invalid_grant' });
        }

        const basic = request.headers.authorization?.startsWith('Basic ')
          ? Buffer.from(request.headers.authorization.slice(6), 'base64').toString('utf8')
          : null;
        const presentedSecret = basic
          ? basic.split(':').slice(1).join(':')
          : form.get('client_secret');
        if (presentedSecret !== clientSecret) return send(401, { error: 'invalid_client' });

        const issued = codes.get(form.get('code') ?? '');
        if (!issued || issued.used || form.get('grant_type') !== 'authorization_code') {
          return send(400, { error: 'invalid_grant' });
        }
        issued.used = true; // um código só vale uma vez
        if (form.get('redirect_uri') !== issued.redirectUri) {
          return send(400, { error: 'invalid_grant' });
        }
        const verifier = form.get('code_verifier');
        if (!verifier || pkceChallenge(verifier) !== issued.codeChallenge) {
          return send(400, { error: 'invalid_grant' });
        }
        return send(200, {
          access_token: `acesso-${randomUUID()}`,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: issued.idToken,
        });
      }

      return send(404, { error: 'not_found' });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor falso sem porta');
  issuerUrl = `http://127.0.0.1:${address.port}`;

  async function signIdToken(
    identity: FakeIdentity,
    nonce: string | undefined,
    tamper: Tamper,
  ): Promise<string> {
    const key: CryptoKey = tamper.signWithUnknownKey ? other.privateKey : privateKey;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { ...identity, nonce };
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'chave-1' })
      .setIssuer(tamper.issuer ?? issuerUrl)
      .setAudience(tamper.audience ?? clientId)
      .setSubject(identity.sub)
      .setIssuedAt(now)
      .setExpirationTime(now + (tamper.expiresInSeconds ?? 3600))
      .sign(key);
  }

  return {
    issuer: new URL(issuerUrl),
    clientId,
    clientSecret,
    lastAuthorization: () => lastAuthorization,
    rejectNextTokenRequest() {
      rejectNext = true;
    },
    tokenRequestCount: () => tokenRequests,

    async approve(authorizationUrl, identity, tamper = {}) {
      const params = authorizationUrl.searchParams;
      lastAuthorization = params;
      const redirectUri = params.get('redirect_uri');
      const codeChallenge = params.get('code_challenge');
      const state = params.get('state');
      if (!redirectUri || !codeChallenge || !state) {
        throw new Error('Pedido de autorização incompleto');
      }

      const code = `codigo-${randomUUID()}`;
      codes.set(code, {
        idToken: await signIdToken(
          identity,
          tamper.nonce ?? params.get('nonce') ?? undefined,
          tamper,
        ),
        codeChallenge,
        redirectUri,
        used: false,
      });

      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', tamper.state ?? state);
      return back;
    },

    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
