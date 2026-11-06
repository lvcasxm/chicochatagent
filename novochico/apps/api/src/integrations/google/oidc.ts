import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import * as client from 'openid-client';

/**
 * Cliente OpenID Connect do Google. Fala o protocolo e valida o que o protocolo exige
 * (state, nonce, PKCE, assinatura, emissor, destinatário e validade do id_token).
 * Não conhece domínios permitidos nem usuários: essas regras são de `modules/auth`.
 *
 * A assinatura do id_token é conferida de forma explícita, com as chaves publicadas pelo
 * próprio provedor. A especificação permite dispensar essa conferência quando o token chega
 * direto do endpoint do provedor por TLS, e o `openid-client` a dispensa; aqui ela é feita
 * mesmo assim, como defesa em profundidade, caso o TLS seja interceptado ou mal configurado.
 */

const GOOGLE_ISSUER = new URL('https://accounts.google.com');
const REQUEST_TIMEOUT_SECONDS = 10;
/** Algoritmo de assinatura dos id_tokens do Google. Qualquer outro (inclusive `none`) é recusado. */
const ID_TOKEN_ALGORITHMS = ['RS256'];

/** Valores gerados no início do login e conferidos na volta. Ficam no cookie temporário. */
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** O que o Google afirma sobre quem entrou, já com os tipos conferidos. */
export interface GoogleIdentityClaims {
  sub: string;
  email: string | undefined;
  /** Só é verdadeiro se o Google enviou exatamente o booleano `true`. */
  emailVerified: boolean;
  /** Domínio do Google Workspace da conta; ausente em contas pessoais. */
  hostedDomain: string | undefined;
  name: string | undefined;
}

/**
 * `unavailable`: não foi possível falar com o Google (rede, descoberta).
 * `rejected`: o Google respondeu, mas a resposta não passou na validação.
 */
export type OidcFailure = 'unavailable' | 'rejected';

export class OidcError extends Error {
  readonly failure: OidcFailure;

  constructor(failure: OidcFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OidcError';
    this.failure = failure;
  }
}

export interface GoogleOidcClient {
  createAuthorizationRequest(input: {
    redirectUri: string;
  }): Promise<{ url: URL; transaction: LoginTransaction }>;

  completeLogin(input: {
    /** Endereço completo da volta do Google, com `code` e `state`. */
    currentUrl: URL;
    transaction: LoginTransaction;
  }): Promise<GoogleIdentityClaims>;
}

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  /** Dica enviada ao Google para mostrar só contas desse domínio. Não é uma validação. */
  hostedDomain?: string | undefined;
  /** Só os testes trocam o emissor, para usar um provedor local. */
  issuer?: URL;
  /** Só os testes permitem HTTP, para usar um provedor local. */
  allowInsecure?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function createGoogleOidcClient(options: GoogleOidcOptions): GoogleOidcClient {
  const issuer = options.issuer ?? GOOGLE_ISSUER;
  let configuration: Promise<client.Configuration> | undefined;

  /** A descoberta é feita na primeira necessidade, para a API subir mesmo se o Google cair. */
  function getConfiguration(): Promise<client.Configuration> {
    configuration ??= client
      .discovery(issuer, options.clientId, options.clientSecret, undefined, {
        timeout: REQUEST_TIMEOUT_SECONDS,
        ...(options.allowInsecure ? { execute: [client.allowInsecureRequests] } : {}),
      })
      .catch((error: unknown) => {
        configuration = undefined; // tenta de novo na próxima requisição
        throw new OidcError('unavailable', 'Falha ao consultar o provedor de login', {
          cause: error,
        });
      });
    return configuration;
  }

  /** Chaves públicas do provedor. O `jose` guarda em cache e cuida da troca periódica de chaves. */
  let signingKeys: ReturnType<typeof createRemoteJWKSet> | undefined;
  function getSigningKeys(config: client.Configuration): ReturnType<typeof createRemoteJWKSet> {
    const jwksUri = config.serverMetadata().jwks_uri;
    if (!jwksUri) throw new OidcError('unavailable', 'O provedor não publica suas chaves');
    signingKeys ??= createRemoteJWKSet(new URL(jwksUri), {
      timeoutDuration: REQUEST_TIMEOUT_SECONDS * 1000,
    });
    return signingKeys;
  }

  return {
    async createAuthorizationRequest({ redirectUri }) {
      const config = await getConfiguration();
      const transaction: LoginTransaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
        code_challenge_method: 'S256',
        state: transaction.state,
        nonce: transaction.nonce,
        prompt: 'select_account',
        ...(options.hostedDomain ? { hd: options.hostedDomain } : {}),
      });
      return { url, transaction };
    },

    async completeLogin({ currentUrl, transaction }) {
      const config = await getConfiguration();
      let claims: client.IDToken | undefined;
      let idToken: string | undefined;
      try {
        const tokens = await client.authorizationCodeGrant(config, currentUrl, {
          pkceCodeVerifier: transaction.codeVerifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          idTokenExpected: true,
        });
        claims = tokens.claims();
        idToken = tokens.id_token;
      } catch (error) {
        throw new OidcError('rejected', 'A resposta do provedor de login foi rejeitada', {
          cause: error,
        });
      }
      if (!idToken) throw new OidcError('rejected', 'A resposta não trouxe o id_token');

      try {
        await jwtVerify(idToken, getSigningKeys(config), {
          issuer: config.serverMetadata().issuer,
          audience: options.clientId,
          algorithms: ID_TOKEN_ALGORITHMS,
        });
      } catch (error) {
        if (error instanceof OidcError) throw error;
        // Não conseguir buscar as chaves não é culpa do token: é indisponibilidade do provedor.
        const failure = error instanceof joseErrors.JWKSTimeout ? 'unavailable' : 'rejected';
        throw new OidcError(failure, 'A assinatura do id_token não pôde ser confirmada', {
          cause: error,
        });
      }

      const sub = asString(claims?.sub);
      if (!claims || !sub) {
        throw new OidcError('rejected', 'O id_token não identifica o usuário');
      }
      return {
        sub,
        email: asString(claims['email']),
        emailVerified: claims['email_verified'] === true,
        hostedDomain: asString(claims['hd']),
        name: asString(claims['name']),
      };
    },
  };
}
