import logoIconBlue from '../assets/brand/logo-icon-blue.png';
import logoVerticalDark from '../assets/brand/logo-vertical-dark.png';
import logoVerticalLight from '../assets/brand/logo-vertical-light.png';
import programBlack from '../assets/brand/pl-digital-black.png';
import programWhite from '../assets/brand/pl-digital-white.png';
import { cx } from '../lib/cx';

/**
 * Assinaturas da marca (identidade, seção I.4). Os arquivos são os oficiais, sem recolorir,
 * distorcer nem recortar a assinatura: a versão certa para cada tema entra por CSS, sem trocar
 * de arquivo depois da primeira pintura.
 *
 * Única correção feita por decisão do responsável: na versão para fundo claro (`logo-vertical-dark`) os
 * óculos eram pretos; agora são brancos, como a boina e como no símbolo, e os detalhes azuis das
 * lentes continuam.
 */
export interface LogoProps {
  /**
   * `vertical`: símbolo e nome (assinatura principal). `symbol`: só o balão, para espaços pequenos.
   */
  variant?: 'vertical' | 'symbol';
  /** Altura da assinatura. Padrão: 56 px (cabeçalho). */
  height?: number;
  /** Use `""` quando o nome já estiver escrito ao lado. */
  alt?: string;
  className?: string;
}

// O arquivo do símbolo tem margem interna grande (632×708 de 1081×1081). Esta janela mostra só o
// desenho, na proporção original, para ele se alinhar às bordas como a assinatura vertical.
const SYMBOL = { width: 632, height: 708, left: 224, top: 186, canvas: 1081 } as const;

export function Logo({
  variant = 'vertical',
  height = 56,
  alt = 'ChicoChat+',
  className,
}: LogoProps) {
  if (variant === 'symbol') {
    const width = Math.round((height * SYMBOL.width) / SYMBOL.height);
    return (
      <span
        className={cx('relative inline-block shrink-0 overflow-hidden', className)}
        style={{ width, height }}
      >
        <img
          src={logoIconBlue}
          alt={alt}
          className="absolute max-w-none"
          style={{
            width: `${(SYMBOL.canvas / SYMBOL.width) * 100}%`,
            left: `${(-SYMBOL.left / SYMBOL.width) * 100}%`,
            top: `${(-SYMBOL.top / SYMBOL.height) * 100}%`,
          }}
        />
      </span>
    );
  }

  // As duas versões têm quase a mesma proporção (974×404 e 974×403).
  const width = Math.round((height * 974) / 404);
  return (
    <span className={cx('inline-block shrink-0', className)} style={{ height, width }}>
      <img
        src={logoVerticalDark}
        alt={alt}
        height={height}
        width={width}
        className="logo-on-light h-full w-full"
      />
      <img
        src={logoVerticalLight}
        alt={alt}
        height={height}
        width={width}
        className="logo-on-dark h-full w-full"
      />
    </span>
  );
}

/** Assinatura do programa PL Digital da Prefeitura, para o rodapé institucional. */
export function ProgramMark({ height = 32, className }: { height?: number; className?: string }) {
  const width = Math.round((height * 859) / 243);
  return (
    <span className={cx('inline-block shrink-0', className)} style={{ height, width }}>
      <img
        src={programBlack}
        alt="Programa PL Digital"
        height={height}
        width={width}
        className="logo-on-light h-full w-full"
      />
      <img
        src={programWhite}
        alt="Programa PL Digital"
        height={height}
        width={width}
        className="logo-on-dark h-full w-full"
      />
    </span>
  );
}
