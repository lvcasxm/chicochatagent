import { expect, test } from '@playwright/test';
import { seriousViolations } from './support';

test.describe('login', () => {
  test('quem não entrou vai ao login e o endereço de volta é guardado', async ({ page }) => {
    await page.goto('/admin/instrucoes');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Finstrucoes$/);
    const link = page.getByRole('link', { name: /entrar com a conta google/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/api\/auth\/google\?redirect=/);
  });

  test('a tela de login não tem violações sérias de acessibilidade (com contraste)', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /entrar com a conta google/i })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('o primeiro Tab leva a um elemento com foco visível', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tab é um fluxo de teclado');
    await page.goto('/login');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('cabeçalhos de segurança chegam com a interface', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });
});
