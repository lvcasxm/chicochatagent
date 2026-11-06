import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme/ThemeProvider';
import { THEME_STORAGE_KEY } from '../app/theme/theme';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Dialog } from './Dialog';
import { ErrorState } from './ErrorState';
import { Field } from './Field';
import { IconButton } from './IconButton';
import { Input } from './Input';
import { Markdown, safeUrl } from './Markdown';
import { ThemeSwitch } from './ThemeSwitch';
import { ToastProvider, useToast } from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Button', () => {
  it('em andamento, não repete o clique e avisa o leitor de tela', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Enviando
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Enviando' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('é type="button" por padrão, para não enviar formulário sem querer', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

describe('IconButton', () => {
  it('tem nome acessível e informa quando está ligado', () => {
    render(<IconButton label="Tema escuro" icon={<svg />} pressed tooltip={false} />);
    const button = screen.getByRole('button', { name: 'Tema escuro' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Field', () => {
  it('liga rótulo, dica e erro ao controle', () => {
    render(
      <Field label="Patrimônio" hint="Está na etiqueta." error="Informe o número.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Patrimônio');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(['Está na etiqueta.', 'Informe o número.']);
  });

  it('diz com palavras que o campo é opcional', () => {
    render(
      <Field label="Ramal" required={false}>
        <Input />
      </Field>,
    );
    expect(screen.getByText(/\(opcional\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Ramal/).getAttribute('aria-required')).toBeNull();
  });
});

describe('Checkbox', () => {
  it('a linha inteira alterna a caixa', async () => {
    render(<Checkbox label="Concordo" />);
    await userEvent.click(screen.getByText('Concordo'));
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
  });
});

describe('Dialog', () => {
  it('fecha com Esc e pelo botão quando é dispensável', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Encerrar?" description={<p>Texto.</p>} />,
    );
    expect(screen.getByRole('dialog', { name: 'Encerrar?' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('não dispensável: sem botão de fechar, e Esc não fecha', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        dismissible={false}
        title="Aviso"
        description={<p>Leia.</p>}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('prende o foco dentro do diálogo', async () => {
    render(
      <>
        <button type="button">Fora</button>
        <Dialog open title="Aviso" footer={<Button>Dentro</Button>} dismissible={false} />
      </>,
    );
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dentro' }));
  });
});

describe('ErrorState', () => {
  it('anuncia o erro e oferece tentar de novo e uma alternativa', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Não foi possível carregar"
        onRetry={onRetry}
        alternative={<a href="https://example.test/portal">Portal de chamados</a>}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Portal de chamados' })).toBeTruthy();
  });
});

describe('Toast', () => {
  function Trigger({ tone }: { tone?: 'danger' }) {
    const { toast } = useToast();
    return (
      <button type="button" onClick={() => toast({ title: 'Aviso de teste', tone })}>
        disparar
      </button>
    );
  }

  it('some sozinho, mas só depois de dar tempo de ler', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('disparar'));
    expect(screen.getByRole('status').textContent).toContain('Aviso de teste');
    void act(() => vi.advanceTimersByTime(7000));
    expect(screen.queryByText('Aviso de teste')).not.toBeNull();
    void act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByText('Aviso de teste')).toBeNull();
  });

  it('erro é anunciado como alerta e não some sozinho', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger tone="danger" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('disparar'));
    expect(screen.getByRole('alert').textContent).toContain('Aviso de teste');
    void act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Markdown', () => {
  it('renderiza listas, negrito e links externos em nova aba', () => {
    const { container } = render(
      <Markdown>
        {'**Atenção**\n\n1. Primeiro\n2. Segundo\n\n[Portal](https://example.test/x)'}
      </Markdown>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Atenção');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    const link = screen.getByRole('link', { name: /Portal/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('não renderiza HTML: o texto aparece e nada é executado ou criado', () => {
    const { container } = render(
      <Markdown>
        {'Oi <script>window.__x = 1</script> <img src=x onerror="window.__x = 2"> <b>b</b>'}
      </Markdown>,
    );
    expect(container.querySelector('script, img, b')).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java&#x73;cript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:x',
    '/caminho/relativo',
    '//evil.example/x',
  ])('o endereço "%s" não vira link', (href) => {
    const { container } = render(<Markdown>{`[clique](${href})`}</Markdown>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('clique');
  });

  it('aceita http, https e mailto, e nenhum outro protocolo', () => {
    expect(safeUrl('https://example.test')).toBe('https://example.test');
    expect(safeUrl('http://example.test')).toBe('http://example.test');
    expect(safeUrl('mailto:ti@example.test')).toBe('mailto:ti@example.test');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('ftp://example.test')).toBeNull();
  });

  it('imagem não carrega: só o texto alternativo fica', () => {
    const { container } = render(<Markdown>{'![pixel](https://tracker.example/p.png)'}</Markdown>);
    expect(container.querySelector('img')).toBeNull();
  });

  it('títulos da resposta não criam um novo h1 na página', () => {
    const { container } = render(<Markdown>{'# Título\n\n## Outro'}</Markdown>);
    expect(container.querySelector('h1, h2')).toBeNull();
  });
});

describe('tema', () => {
  it('segue o sistema por padrão, sem gravar nada', () => {
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(
      screen.getByRole('button', { name: 'Tema do sistema' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('a escolha é aplicada ao documento e persiste', async () => {
    const view = render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tema escuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    // Uma nova visita lê a escolha salva.
    view.unmount();
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Tema escuro' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('voltar para "sistema" apaga a escolha salva', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tema do sistema' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('valor salvo inválido é ignorado', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'roxo');
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
