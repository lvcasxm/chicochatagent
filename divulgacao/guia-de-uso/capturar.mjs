// Captura telas reais do ChicoChat+ (build de produção) com dados fictícios: a API é simulada aqui,
// sem banco, sem servidor real e sem nenhum dado de pessoa.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'C:/dev/novochico/novochico';
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'capturas');
mkdirSync(SHOTS, { recursive: true });
const PORT = 4179;

const server = spawn(
  'node',
  ['../../node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: `${ROOT}/apps/web`, stdio: 'ignore' },
);
const stop = () => {
  try {
    execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // Já encerrado.
  }
};

const CONV = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ME = {
  id: uid(1),
  email: 'maria.souza@prefeitura.example.test',
  fullName: 'Maria Souza',
  role: 'user',
  defaultSector: null,
  privacyAccepted: true,
};
const card = (key, title, action = 'chat', externalUrl = null) => ({
  key,
  title,
  description: null,
  icon: null,
  action,
  externalUrl,
  secondaryLink: null,
  cannedMessage: action === 'chat' ? `Olá! Preciso de ajuda com ${title}.` : null,
});
const BOOT = {
  cards: [
    card('hardware', 'Computador e Equipamentos'),
    card('password', 'Acessos e Senhas'),
    card('grp', 'Sistemas GRP Sonner', 'external_link', 'https://example.test/guia.pdf'),
    card('network', 'Rede e internet'),
  ],
  glpiPortalUrl: 'https://suporte.example.test/',
  canUseTestMode: false,
  lastSector: null,
};
const LIST = {
  conversations: [
    { id: CONV, title: 'Computador lento desde ontem', categoryKey: 'hardware', outcome: 'escalated', lastMessageAt: ago(4) },
    { id: uid(11), title: 'E-mail não envia anexos', categoryKey: null, outcome: 'resolved', lastMessageAt: ago(60 * 26) },
    { id: uid(12), title: 'Impressora do setor offline', categoryKey: null, outcome: 'escalated', lastMessageAt: ago(60 * 24 * 3) },
  ],
};
const msg = (n, role, content, min) => ({ id: uid(100 + n), role, content, incomplete: false, createdAt: ago(min) });
const DETAIL = {
  ...LIST.conversations[0],
  messages: [
    msg(1, 'user', 'Meu computador da recepção ficou muito lento desde ontem à tarde, depois de uma atualização do Windows. Demora uns 5 minutos para abrir o e-mail. Já reiniciei duas vezes.', 12),
    msg(2, 'assistant', 'Obrigado pelos detalhes. Isso acontece só no seu computador ou outros colegas do setor também notaram?', 11),
    msg(3, 'user', 'Só no meu. O computador da mesa ao lado está normal.', 9),
    msg(4, 'assistant', 'Como você já reiniciou e a lentidão começou depois da atualização, a equipe técnica precisa avaliar a máquina. Vou liberar o formulário para abrir o chamado.', 8),
  ],
  triage: { resolutionAttempts: 1, issuePersists: true, ticketFormUnlocked: true, testMode: false, resolved: false, feedback: 'unavailable' },
};
const MINE = {
  notice: null,
  tickets: [
    { id: '4821', title: 'Computador lento após atualização do Windows', statusLabel: 'Em atendimento', createdAt: ago(60 * 3), updatedAt: ago(35), urgencyLabel: 'Média', description: 'Lentidão desde ontem à tarde, depois de uma atualização do Windows. Só neste computador. Reiniciar não resolveu.' },
    { id: '4790', title: 'Impressora do setor offline', statusLabel: 'Solucionado', createdAt: ago(60 * 24 * 3), updatedAt: ago(60 * 24 * 2), urgencyLabel: 'Média', description: null },
    { id: '4712', title: 'Acesso ao sistema de compras', statusLabel: 'Fechado', createdAt: ago(60 * 24 * 12), updatedAt: ago(60 * 24 * 10), urgencyLabel: 'Baixa', description: null },
  ],
};

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
async function mock(page) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    if (key === 'GET /api/me') return json(route, ME);
    if (key === 'GET /api/bootstrap') return json(route, BOOT);
    if (key === 'GET /api/conversations') return json(route, LIST);
    if (key === `GET /api/conversations/${CONV}`) return json(route, DETAIL);
    if (key === 'GET /api/tickets/mine') return json(route, MINE);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  const page = await ctx.newPage();
  await mock(page);
  const idle = async () => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(200);
  };

  // Tela inicial, com a posição de cada elemento para os marcadores do guia.
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('heading', { name: 'Como posso te ajudar hoje?' }).waitFor();
  await page.getByText('Computador e Equipamentos').waitFor();
  await page.getByText('Computador lento desde ontem').waitFor();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height });
  await idle();
  const boxes = {
    size: { w: 1280, h: height },
    nova: await page.getByRole('link', { name: 'Nova conversa' }).boundingBox(),
    chamados: await page.getByRole('link', { name: 'Meus chamados' }).boundingBox(),
    historico: await page.locator('nav[aria-label="Conversas"] ul').boundingBox(),
    campo: await page.locator('main form').first().boundingBox(),
    atalhos: await page.locator('section[aria-labelledby="atalhos"] ul').boundingBox(),
    avancado: await page.getByRole('link', { name: /Sou usuário avançado/ }).boundingBox(),
  };
  writeFileSync(join(SHOTS, 'posicoes.json'), JSON.stringify(boxes, null, 2));
  await page.screenshot({ path: join(SHOTS, 'inicio.png') });

  // Conversa com o formulário liberado.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`http://127.0.0.1:${PORT}/c/${CONV}`);
  await page.getByText('Abertura de chamado liberada').waitFor();
  await idle();
  await page.locator('main .max-w-reading').first().screenshot({ path: join(SHOTS, 'conversa.png') });

  // Formulário preenchido.
  await page.getByRole('button', { name: 'Abrir chamado' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Seu setor/).fill('Secretaria de Saúde');
  await dialog.getByLabel(/IP da máquina/).fill('10.1.2.30');
  await page.setViewportSize({ width: 1280, height: 1200 });
  await idle();
  await dialog.screenshot({ path: join(SHOTS, 'formulario.png') });

  // Meus chamados.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/chamados`);
  await page.getByRole('button', { name: /Chamado nº 4821/ }).click();
  await idle();
  await page.locator('main > div').first().screenshot({ path: join(SHOTS, 'meus-chamados.png') });
  await browser.close();
  console.log(JSON.stringify(boxes));
} finally {
  stop();
}
