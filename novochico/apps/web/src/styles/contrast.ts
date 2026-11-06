/** Cálculo de contraste da WCAG 2 e leitura dos tokens de cor de `tokens.css`. Usado pelos testes. */

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Razão de contraste entre duas cores `#rrggbb`, de 1 a 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Lê os tokens hexadecimais de cada tema (`light` no `:root`, `dark` em `[data-theme='dark']`). */
export function parseTokens(css: string): Record<'light' | 'dark', Record<string, string>> {
  const darkStart = css.indexOf("[data-theme='dark']");
  const read = (block: string) =>
    Object.fromEntries(
      [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [
        m[1]!,
        m[2]!.toLowerCase(),
      ]),
    );
  return { light: read(css.slice(0, darkStart)), dark: read(css.slice(darkStart)) };
}
