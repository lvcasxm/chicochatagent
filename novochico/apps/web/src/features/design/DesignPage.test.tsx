import { render } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../app/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import { DesignPage } from './DesignPage';

describe('página de design', () => {
  it('não tem violações de acessibilidade detectáveis pelo axe', async () => {
    const { container } = render(
      <ThemeProvider>
        <ToastProvider>
          <DesignPage />
        </ToastProvider>
      </ThemeProvider>,
    );

    // O jsdom não calcula estilos: o contraste é verificado sobre os tokens em `tokens.test.ts`.
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });

    const summary = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`,
    );
    expect(summary).toEqual([]);
  });

  it('mostra os dois temas e todos os componentes exigidos', () => {
    const { container } = render(
      <ThemeProvider>
        <ToastProvider>
          <DesignPage />
        </ToastProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-theme="light"]')).not.toBeNull();
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull();
    for (const group of [
      'Cores',
      'Tipografia',
      'Botões',
      'Campos',
      'Diálogo, dica e avisos',
      'Estados',
      'Markdown',
      'Marca',
    ]) {
      expect(container.textContent).toContain(group);
    }
  });
});
