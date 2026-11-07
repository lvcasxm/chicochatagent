// Gera o PDF a partir de guia.html com o Chrome instalado e salva uma imagem de cada página.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('C:/dev/novochico/novochico/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW = process.argv[2];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(join(HERE, 'guia.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: join(HERE, 'Como-Abrir-um-Chamado-no-GLPI.pdf'), preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });

// Conteúdo que passa do fim da página ou invade o rodapé.
const report = await page.evaluate(() =>
  [...document.querySelectorAll('.page')].map((section, i) => {
    const box = section.getBoundingClientRect();
    const foot = section.querySelector('.foot')?.getBoundingClientRect();
    const limit = foot ? foot.top : box.bottom;
    let bottom = 0;
    for (const el of section.querySelectorAll('*')) {
      if (el.closest('.foot')) continue;
      const r = el.getBoundingClientRect();
      if (r.height) bottom = Math.max(bottom, r.bottom);
    }
    return `página ${i + 1}: conteúdo termina em ${Math.round(bottom - box.top)} | limite ${Math.round(limit - box.top)}`;
  }),
);
console.log(report.join('\n'));

if (REVIEW) {
  mkdirSync(REVIEW, { recursive: true });
  const sections = await page.locator('.page').all();
  for (const [i, section] of sections.entries()) await section.screenshot({ path: join(REVIEW, `p${i + 1}.png`) });
}
await browser.close();
