// Gera o PDF do estudo a partir de estudo.html e, opcionalmente, uma imagem de cada página para revisão.
// Uso: node estudo-robustez/gerar-pdf.mjs [pasta-de-revisao]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'Robustez-do-Agente-ChicoChat.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(join(HERE, 'estudo.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: OUT, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
await browser.close();
console.log(OUT);
