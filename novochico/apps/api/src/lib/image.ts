import sharp from 'sharp';

/** Formatos aceitos, conferidos pelo conteúdo do arquivo (o nome e o tipo declarado não valem). */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp']);

/** Lado maior da imagem guardada: basta para ler uma mensagem de erro na tela. */
const MAX_SIDE = 1600;

/** Recusa antes de decodificar imagens com dimensões absurdas, que esgotariam a memória. */
const MAX_INPUT_PIXELS = 40_000_000;

export interface StoredImage {
  mimeType: 'image/webp';
  data: Buffer;
}

/**
 * Prepara a imagem enviada pela pessoa: confere que é PNG, JPEG ou WebP de verdade, aplica a
 * rotação da foto, reduz e regrava em WebP. A regravação descarta os metadados do original (EXIF,
 * com localização e modelo do aparelho). Devolve nulo se o arquivo não for uma imagem aceita.
 */
export async function prepareImage(input: Buffer): Promise<StoredImage | null> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const { format } = await image.metadata();
    if (!format || !ACCEPTED_FORMATS.has(format)) return null;
    const data = await image
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    return { mimeType: 'image/webp', data };
  } catch {
    return null;
  }
}

/**
 * Converte a imagem guardada para PNG, formato que qualquer GLPI aceita como documento (o WebP
 * depende da lista de tipos de cada instância). A conversão não perde mais nada da imagem guardada.
 */
export function toPng(data: Buffer): Promise<Buffer> {
  return sharp(data).png().toBuffer();
}
