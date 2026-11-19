import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareImage } from './image';

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#24BCEC' } });
}

describe('prepareImage', () => {
  it('aceita PNG, JPEG e WebP e devolve WebP', async () => {
    for (const input of [
      await solid(40, 30).png().toBuffer(),
      await solid(40, 30).jpeg().toBuffer(),
      await solid(40, 30).webp().toBuffer(),
    ]) {
      const result = await prepareImage(input);
      expect(result?.mimeType).toBe('image/webp');
      expect((await sharp(result!.data).metadata()).format).toBe('webp');
    }
  });

  it('reduz o lado maior para 1600 px, mantendo a proporção, e não amplia imagens pequenas', async () => {
    const big = await prepareImage(await solid(4000, 2000).png().toBuffer());
    expect(await sharp(big!.data).metadata()).toMatchObject({ width: 1600, height: 800 });

    const small = await prepareImage(await solid(300, 200).png().toBuffer());
    expect(await sharp(small!.data).metadata()).toMatchObject({ width: 300, height: 200 });
  });

  it('descarta os metadados do original e aplica a rotação da foto', async () => {
    // Foto "deitada" com orientação 6 (girar 90°) e EXIF: o resultado fica em pé e sem EXIF.
    const photo = await solid(60, 40)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: 'Celular', Model: 'Teste' } } })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();

    const result = await prepareImage(photo);
    const meta = await sharp(result!.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 40, height: 60 });
  });

  it('recusa o que não é imagem aceita', async () => {
    expect(await prepareImage(Buffer.from('não sou uma imagem'))).toBeNull();
    expect(await prepareImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(await prepareImage(await solid(10, 10).gif().toBuffer())).toBeNull();
    // PNG cortado no meio.
    const png = await solid(200, 200).png().toBuffer();
    expect(await prepareImage(png.subarray(0, png.length / 2))).toBeNull();
  });
});
