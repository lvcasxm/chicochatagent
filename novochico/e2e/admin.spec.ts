import { expect, test } from '@playwright/test';
import { seriousViolations, signIn } from './support';

test.describe('administração', () => {
  test('as telas abrem e não têm violações sérias de acessibilidade', async ({ page, context }) => {
    await signIn(context, 'admin');
    for (const [path, heading] of [
      ['/admin', 'Visão geral'],
      ['/admin/conversas', 'Conversas'],
      ['/admin/categorias', 'Cards da tela inicial'],
      ['/admin/prompt', 'Prompt efetivo'],
      ['/admin/usuarios', 'Usuários e papéis'],
      ['/admin/auditoria', 'Auditoria'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await seriousViolations(page), path).toEqual([]);
    }
  });

  test('instruções: pedir à IA, comparar, ensaiar e ver a confirmação de publicar', async ({
    page,
    context,
  }) => {
    await signIn(context, 'admin');
    await page.goto('/admin/instrucoes');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Instruções do agente' }),
    ).toBeVisible();

    await page
      .getByLabel('O que deve mudar?')
      .fill('Quando for impressora, pergunte o número do patrimônio.');
    // O banco é o mesmo nas quatro combinações: a partir da segunda já existe um rascunho.
    await page.getByRole('button', { name: /^Pedir (à IA|um novo ajuste)$/ }).click();
    await expect(page.getByRole('heading', { name: /Rascunho \(versão \d+\)/ })).toBeVisible();

    const diff = page.getByRole('group', { name: /diferenças/i });
    await expect(diff).toContainText('número do patrimônio');
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Ensaiar' }).click();
    await page.getByLabel('Mensagem para o agente').fill('Minha impressora parou');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByText('Para começar: qual equipamento')).toBeVisible();

    await page.getByRole('button', { name: 'Publicar o rascunho' }).click();
    const dialog = page.getByRole('dialog', { name: /Publicar a versão \d+\?/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
  });
});
