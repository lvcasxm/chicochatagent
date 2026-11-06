const MAX_LENGTH = 512;
const FALLBACK = '/';

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Para onde mandar o usuário depois do login. Só aceita um caminho do próprio sistema:
 * qualquer outra coisa (endereço completo, `//outro.site`, barra invertida, caracteres de
 * controle) volta para a página inicial, o que impede usar o login para redirecionar a sites
 * de terceiros. Também evita voltar para a tela de login ou para a própria API.
 */
export function safeRedirectPath(input: unknown): string {
  if (typeof input !== 'string') return FALLBACK;
  if (input.length === 0 || input.length > MAX_LENGTH) return FALLBACK;
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return FALLBACK;
  if (hasControlCharacter(input)) return FALLBACK;

  let parsed: URL;
  try {
    parsed = new URL(input, 'http://sistema.invalid');
  } catch {
    return FALLBACK;
  }
  if (parsed.origin !== 'http://sistema.invalid') return FALLBACK;
  if (parsed.pathname === '/login' || parsed.pathname.startsWith('/api/')) return FALLBACK;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
