import { expect, test, type Page } from '@playwright/test';
import { seriousViolations, signIn } from './support';

/**
 * Rola até o fim da página, como uma pessoa faria. No celular, o campo de mensagem fica fixo no
 * rodapé e cobre o que está logo acima dele; no fim da página ele volta ao seu lugar.
 */
async function toBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

test.describe('atendimento de ponta a ponta (IA e GLPI de mentira)', () => {
  test('conversa, formulário liberado, chamado aberto e avaliação', async ({ page, context }) => {
    await signIn(context, 'user');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Como posso te ajudar hoje?' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    const composer = page.getByLabel('Mensagem para o ChicoChat+');
    const send = page.getByRole('button', { name: 'Enviar mensagem' });

    // A resposta começa em até 2 s (meta da F9, com a IA de mentira).
    await composer.fill('Minha impressora parou de imprimir');
    const started = Date.now();
    await send.click();
    await expect(page.getByText('Para começar: qual equipamento')).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - started).toBeLessThan(2_000);

    await composer.fill('É a impressora da sala 3');
    await send.click();
    await expect(page.getByText('Reinicie')).toBeVisible();

    await composer.fill('O problema continua');
    await send.click();
    await expect(page.getByText('vou abrir um chamado')).toBeVisible();
    // Os marcadores técnicos nunca aparecem para a pessoa.
    await expect(page.getByText('OPEN_TICKET_FORM')).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    // O aviso de formulário liberado chega depois do texto; rolar antes dele aparecer deixaria o
    // botão se mover durante o clique.
    await expect(page.getByText('Abertura de chamado liberada')).toBeVisible();
    await toBottom(page);
    await page.getByRole('button', { name: 'Abrir chamado' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Seu setor').fill('Secretaria de Saúde');
    await dialog.getByLabel('IP da máquina').fill('10.0.0.10');
    expect(await seriousViolations(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Abrir chamado' }).click();
    await expect(dialog.getByText(/Chamado nº \d+/).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar' }).last().click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('heading', { name: 'Como foi o atendimento?' })).toBeVisible();
    await toBottom(page);
    await page.locator('label:has(input[value="5"])').click();
    await expect(page.getByRole('radio', { name: /^5/ })).toBeChecked();
    await toBottom(page);
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    await expect(page.getByText('Obrigado pela avaliação.')).toBeVisible();

    await page.goto('/chamados');
    await expect(page.getByRole('heading', { name: 'Meus chamados' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('o atalho abre a conversa com a mensagem pronta', async ({ page, context }) => {
    await signIn(context, 'user');
    await page.goto('/');
    await page.getByRole('button', { name: /Rede e internet/ }).click();
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Para começar: qual equipamento')).toBeVisible();
  });

  test('usuário comum não vê nem abre a administração', async ({ page, context }) => {
    await signIn(context, 'user');
    await page.goto('/');
    await expect(page.getByRole('link', { name: /administração/i })).toHaveCount(0);
    await page.goto('/admin');
    await expect(page.getByText('Esta área é só para administradores')).toBeVisible();
    const api = await page.request.get('/api/admin/metrics');
    expect(api.status()).toBe(403);
  });
});
