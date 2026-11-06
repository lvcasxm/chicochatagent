import type { GoogleIdentityClaims } from '../../integrations/google/oidc';
import type { VerifiedIdentity } from '../users';

export type IdentityRejection = 'domain' | 'unverified';

export type IdentityDecision =
  { ok: true; identity: VerifiedIdentity } | { ok: false; reason: IdentityRejection };

/** Domínio de um e-mail simples (`nome@dominio`); nulo para qualquer outra forma. */
function domainOf(email: string): string | null {
  const parts = email.split('@');
  const [local, domain] = parts;
  if (parts.length !== 2 || !local || !domain) return null;
  return domain;
}

/**
 * Decide, no servidor, se uma conta Google pode usar o sistema. Nada aqui depende do navegador
 * nem do texto digitado pelo usuário. É preciso, ao mesmo tempo:
 *
 * 1. o domínio do e-mail estar na lista permitida (comparação exata, nunca por sufixo);
 * 2. o Google afirmar que a conta pertence a um Workspace (`hd`) também permitido. Sem isso,
 *    uma conta pessoal registrada com um e-mail do domínio poderia entrar;
 * 3. o e-mail estar verificado.
 *
 * O `hd` pode diferir do domínio do e-mail quando este é um domínio-alias do Workspace.
 */
export function evaluateIdentity(
  claims: GoogleIdentityClaims,
  allowedDomains: readonly string[],
): IdentityDecision {
  const email = claims.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'unverified' };

  const emailDomain = domainOf(email);
  if (!emailDomain || !allowedDomains.includes(emailDomain)) {
    return { ok: false, reason: 'domain' };
  }

  const hostedDomain = claims.hostedDomain?.trim().toLowerCase();
  if (!hostedDomain || !allowedDomains.includes(hostedDomain)) {
    return { ok: false, reason: 'domain' };
  }

  if (!claims.emailVerified) return { ok: false, reason: 'unverified' };

  const localPart = email.slice(0, email.indexOf('@'));
  return {
    ok: true,
    identity: {
      googleSub: claims.sub,
      email,
      fullName: claims.name?.trim() || localPart,
    },
  };
}
