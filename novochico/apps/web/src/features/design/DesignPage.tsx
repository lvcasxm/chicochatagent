import { ArrowRight, Copy, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { IconButton } from '../../components/IconButton';
import { Input, Textarea } from '../../components/Input';
import { Logo, ProgramMark } from '../../components/Logo';
import { Markdown } from '../../components/Markdown';
import { Notice } from '../../components/Notice';
import { PortalContainerContext } from '../../components/portal';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { ToastCard, useToast } from '../../components/Toast';

/**
 * Página de design (só em desenvolvimento, em `/_design`): todos os componentes e estados, nos dois
 * temas ao mesmo tempo. É a referência para revisar a aparência antes de construir telas.
 */

const SWATCHES: Array<{ token: string; note: string }> = [
  { token: 'bg', note: 'fundo' },
  { token: 'surface', note: 'superfície' },
  { token: 'surface-hover', note: 'hover' },
  { token: 'border', note: 'divisória' },
  { token: 'border-strong', note: 'borda de campo' },
  { token: 'fg', note: 'texto' },
  { token: 'fg-muted', note: 'texto secundário' },
  { token: 'accent', note: 'destaque' },
  { token: 'accent-soft', note: 'seleção suave' },
  { token: 'danger', note: 'erro' },
  { token: 'warning', note: 'contingência' },
];

const TYPE_STYLES: Array<{ cls: string; name: string; spec: string }> = [
  { cls: 'type-title-1', name: 'Título 1', spec: 'Montserrat 500 · 56/64 (38/44 no celular)' },
  { cls: 'type-title-2', name: 'Título 2', spec: 'Montserrat 500 · 36/44 (30/36 no celular)' },
  { cls: 'type-title-3', name: 'Título 3', spec: 'Montserrat 600 · 20/28' },
  { cls: 'type-lead', name: 'Texto de destaque', spec: 'Inter 400 · 20/30' },
  { cls: 'type-body', name: 'Texto', spec: 'Inter 400 · 16/24' },
  { cls: 'type-label', name: 'Rótulo', spec: 'Inter 500 · 16/24' },
  { cls: 'type-small', name: 'Texto pequeno', spec: 'Inter 400 · 14/20' },
  { cls: 'type-caption', name: 'Legenda', spec: 'Inter 600 · 12/16' },
];

const SECTORS = [
  { value: 'saude', label: 'Secretaria de Saúde' },
  { value: 'educacao', label: 'Secretaria de Educação' },
  { value: 'fazenda', label: 'Secretaria de Fazenda' },
];

const MARKDOWN_SAMPLE = `### Verifique estes pontos

1. Confira se o cabo de rede está **firme** nas duas pontas.
2. Reinicie o computador e tente _de novo_.
3. Se continuar, abra um chamado pelo [portal de chamados](https://example.com/chamados).

> A resposta nunca executa HTML: <script>alert(1)</script> aparece como texto.

Este [link perigoso](javascript:alert(1)) perde o endereço, e \`código\` fica em linha.`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <h3 className="type-title-3 border-b border-border pb-3">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-4">{children}</div>;
}

function Showcase() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sector, setSector] = useState<string>();

  return (
    <div className="flex flex-col gap-16">
      <Group title="Cores">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SWATCHES.map(({ token, note }) => (
            <li key={token} className="flex flex-col gap-2">
              <span
                className="h-12 rounded-tag border border-border"
                style={{ backgroundColor: `var(--${token})` }}
              />
              <span className="type-small">
                <code>--{token}</code>
                <br />
                <span className="text-fg-muted">{note}</span>
              </span>
            </li>
          ))}
        </ul>
        <Row>
          <span className="type-label rounded-pill bg-accent px-6 py-2 text-accent-fg">
            Sobre o azul: #111110
          </span>
          <a href="#cores">Link no texto</a>
        </Row>
      </Group>

      <Group title="Tipografia">
        <dl className="flex flex-col gap-6">
          {TYPE_STYLES.map(({ cls, name, spec }) => (
            <div key={cls} className="flex flex-col gap-1">
              <dt className="type-small text-fg-muted">
                {name} · {spec}
              </dt>
              <dd className={cls}>Conexão que resolve</dd>
            </div>
          ))}
        </dl>
      </Group>

      <Group title="Botões">
        <Row>
          <Button>Enviar</Button>
          <Button iconEnd={<ArrowRight className="size-5" />}>Continuar</Button>
          <Button variant="outline">Voltar</Button>
          <Button variant="ghost">Cancelar</Button>
          <Button variant="danger">Excluir</Button>
        </Row>
        <Row>
          <Button disabled>Desativado</Button>
          <Button variant="outline" disabled>
            Desativado
          </Button>
          <Button loading>Enviando…</Button>
          <IconButton label="Copiar" icon={<Copy className="size-5" />} />
          <IconButton label="Enviar mensagem" icon={<Send className="size-5" />} pressed />
        </Row>
      </Group>

      <Group title="Campos">
        <Field label="Setor" hint="Onde você trabalha.">
          <Select
            options={SECTORS}
            value={sector}
            onValueChange={setSector}
            placeholder="Escolha um setor"
          />
        </Field>
        <Field label="Assunto">
          <Input placeholder="Ex.: impressora sem papel" />
        </Field>
        <Field label="Ramal" required={false} hint="Só números.">
          <Input inputMode="numeric" />
        </Field>
        <Field label="Patrimônio" error="Informe o número que está na etiqueta do computador.">
          <Input defaultValue="abc" />
        </Field>
        <Field label="Descreva o problema">
          <Textarea />
        </Field>
        <Checkbox label="Li e concordo com o aviso de privacidade" />
        <Field label="Campo desativado">
          <Input disabled defaultValue="Indisponível" />
        </Field>
      </Group>

      <Group title="Diálogo, dica e avisos">
        <Row>
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            Abrir diálogo
          </Button>
          <Button
            variant="ghost"
            onClick={() => toast({ title: 'Copiado para a área de transferência' })}
          >
            Mostrar aviso
          </Button>
        </Row>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Encerrar esta conversa?"
          description={<p>Você pode voltar a ela depois, pelo histórico.</p>}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Voltar
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Encerrar</Button>
            </>
          }
        />
        <div className="flex flex-col gap-3">
          <ToastCard title="Mensagem copiada" onDismiss={() => undefined} />
          <ToastCard
            tone="warning"
            title="Modo de contingência"
            description="A IA está instável. Você ainda pode abrir um chamado."
            onDismiss={() => undefined}
          />
          <ToastCard
            tone="danger"
            title="Não foi possível enviar"
            description="Tente de novo em instantes."
            onDismiss={() => undefined}
          />
        </div>
        <Notice>Seus dados de acesso vêm da conta institucional.</Notice>
        <Notice tone="warning">A IA está em contingência: o chamado segue o formulário.</Notice>
        <Notice tone="danger">Não foi possível entrar com essa conta.</Notice>
      </Group>

      <Group title="Estados">
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">Carregando exemplo</span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
        <EmptyState
          title="Nenhum chamado por aqui"
          description="Quando você abrir um chamado, ele aparece nesta lista."
          action={<Button variant="outline">Falar com o ChicoChat+</Button>}
        />
        <ErrorState
          title="Não foi possível carregar seus chamados"
          description="O sistema não respondeu. Seus dados continuam salvos."
          onRetry={() => undefined}
          alternative={<a href="#estados">Abrir o portal de chamados</a>}
        />
      </Group>

      <Group title="Markdown">
        <Markdown>{MARKDOWN_SAMPLE}</Markdown>
      </Group>

      <Group title="Marca">
        <Row>
          <Logo />
          <Logo variant="symbol" />
          <ProgramMark />
        </Row>
      </Group>
    </div>
  );
}

function ThemePanel({ theme, label }: { theme: 'light' | 'dark'; label: string }) {
  // Diálogos e listas saem do painel, para herdarem o tema dele e não o do documento.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <section
      ref={setContainer}
      data-theme={theme}
      aria-label={label}
      className="min-w-0 rounded-lg border border-border bg-bg p-6 text-fg sm:p-8"
    >
      <PortalContainerContext.Provider value={container}>
        <h2 className="type-title-2 mb-12">{label}</h2>
        <Showcase />
      </PortalContainerContext.Provider>
    </section>
  );
}

export function DesignPage() {
  return (
    <main className="mx-auto flex max-w-page flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="type-title-1">Design system</h1>
          <p className="type-lead text-fg-muted">
            Componentes e estados, nos dois temas. Só em desenvolvimento.
          </p>
        </div>
        <ThemeSwitch />
      </header>
      <div className="grid gap-8 lg:grid-cols-2">
        <ThemePanel theme="light" label="Tema claro" />
        <ThemePanel theme="dark" label="Tema escuro" />
      </div>
    </main>
  );
}
