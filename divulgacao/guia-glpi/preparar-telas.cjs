// Prepara as telas do GLPI vindas do manual antigo: apaga dados pessoais nos próprios pixels
// (usuário, iniciais e nome da máquina) e recorta. Assim nada disso fica escondido dentro do PDF.
// Uso: node preparar-telas.cjs <pasta com tela-*.raw extraídas> <pasta de saída>
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const [src, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const crcT = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = ~0;
  for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};
const chunk = (t, d) => {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const r = Buffer.alloc(4);
  r.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, r]);
};

function savePng(file, px, W, crop) {
  const [x0, y0, x1, y1] = crop;
  const w = x1 - x0;
  const h = y1 - y0;
  const rows = [];
  for (let y = y0; y < y1; y++) {
    rows.push(Buffer.from([0]), px.subarray((y * W + x0) * 3, (y * W + x1) * 3));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(
    path.join(out, file),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  console.log(file, `${w}x${h}`);
}

// Pinta um retângulo com a cor do pixel logo à esquerda dele (o fundo daquele trecho).
function paint(px, W, [x0, y0, x1, y1]) {
  const i = (y0 * W + x0 - 1) * 3;
  const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * W + x) * 3;
      px[p] = r;
      px[p + 1] = g;
      px[p + 2] = b;
    }
  }
}

const SCREENS = [
  { obj: 223, w: 1529, h: 765, file: 'login.png', erase: [], crop: [390, 65, 1140, 615] },
  { obj: 245, w: 960, h: 477, file: 'inicio.png', erase: [[675, 4, 815, 34]], crop: [0, 0, 960, 468] },
  { obj: 235, w: 1152, h: 573, file: 'catalogo.png', erase: [[815, 6, 980, 40]], crop: [170, 0, 980, 190] },
  // Além do usuário, apaga o nome e o número de patrimônio da máquina.
  { obj: 248, w: 1919, h: 952, file: 'formulario.png', erase: [[1360, 8, 1625, 60], [716, 408, 930, 431]], crop: [460, 162, 1450, 910] },
  { obj: 260, w: 1344, h: 668, file: 'enviado.png', erase: [[955, 6, 1145, 44]], crop: [200, 0, 1150, 260] },
  { obj: 278, w: 1536, h: 764, file: 'chamados.png', erase: [[1090, 8, 1305, 50]], crop: [240, 0, 1300, 245] },
];

for (const s of SCREENS) {
  const px = zlib.inflateSync(fs.readFileSync(path.join(src, `img-${s.obj}.raw`)));
  if (px.length !== s.w * s.h * 3) throw new Error(`tamanho inesperado: ${s.obj}`);
  for (const rect of s.erase) paint(px, s.w, rect);
  savePng(s.file, px, s.w, s.crop);
}
