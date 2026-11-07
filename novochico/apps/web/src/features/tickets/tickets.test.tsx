import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketDialog, type TicketDialogProps } from './TicketDialog';

const CONVERSATION_ID = '3f9a1c52-8d4e-4b7a-9c1e-2a6b5d8e0f13';
const PORTAL = 'https://chamados.example.test/';
const CHECK_URL = `POST /api/conversations/${CONVERSATION_ID}/ticket-check`;
const CREATE_URL = `POST /api/conversations/${CONVERSATION_ID}/tickets`;

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const SUCCESS = {
  status: 'success',
  ticketId: '1000',
  title: 'Internet caiu',
  message: 'Chamado nº 1000 aberto.',
};
const EMPTY_CHECK = { similar: [], collective: null };

interface Call {
  key: string;
  body: Record<string, unknown> | undefined;
  idempotencyKey: string | undefined;
}

function mockApi(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const key = `${init?.method ?? 'GET'} ${url}`;
      const headers = new Headers(init?.headers);
      calls.push({
        key,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
        idempotencyKey: headers.get('idempotency-key') ?? undefined,
      });
      const handler = routes[key];
      return handler ? Promise.resolve(handler()) : Promise.resolve(json(404, {}));
    }),
  );
  return calls;
}

function renderDialog(overrides: Partial<TicketDialogProps> = {}) {
  const props: TicketDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    conversationId: CONVERSATION_ID,
    requester: { name: 'Maria Silva', email: 'maria@prefeitura.example.test' },
    lastSector: null,
    testMode: false,
    portalUrl: PORTAL,
    onCreated: vi.fn(),
    ...overrides,
  };
  render(<TicketDialog {...props} />);
  return props;
}

const ipField = () => screen.getByLabelText(/^IP da máquina/);
const sectorField = () => screen.getByLabelText(/^Seu setor/);
const submit = () => userEvent.click(screen.getByRole('button', { name: /^abrir chamado$/i }));

async function fillValid() {
  await userEvent.type(sectorField(), 'Secretaria de Saúde');
  await userEvent.type(ipField(), '10.1.2.30');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Pai com o estado do diálogo, como a tela do chat: é ele quem fecha de verdade. */
function Host() {
  const [open, setOpen] = useState(true);
  return (
    <TicketDialog
      open={open}
      onOpenChange={setOpen}
      conversationId={CONVERSATION_ID}
      requester={{ name: 'Maria Silva', email: 'maria@prefeitura.example.test' }}
      lastSector={null}
      testMode={false}
      portalUrl={PORTAL}
      onCreated={() => undefined}
    />
  );
}

describe('fechar o diálogo (com o pai controlando o estado)', () => {
  it('depois de abrir o chamado, "Fechar" fecha o diálogo de verdade', async () => {
    mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    render(<Host />);
    await fillValid();
    await submit();
    await screen.findByText('Chamado nº 1000 aberto.');
    await userEvent.click(
      within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Fechar' }).at(-1)!,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancelar e Esc também fecham', async () => {
    mockApi({});
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('formulário', () => {
  it('mostra a identidade da sessão só para leitura, e orienta como achar o IP', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Abrir chamado' });
    expect(within(dialog).getByText('Maria Silva')).toBeTruthy();
    expect(within(dialog).getByText('maria@prefeitura.example.test')).toBeTruthy();
    // Nome e e-mail não são campos: não há como alterá-los.
    expect(within(dialog).queryByRole('textbox', { name: /^(nome|e-mail)/i })).toBeNull();
    expect(within(dialog).getByText(/clique duas vezes no arquivo MostrarIP.bat/)).toBeTruthy();
  });

  it('pré-preenche o último setor e oferece sugestões', () => {
    renderDialog({ lastSector: 'Secretaria de Educação' });
    expect((sectorField() as HTMLInputElement).value).toBe('Secretaria de Educação');
    expect(document.querySelectorAll('datalist option').length).toBeGreaterThan(10);
  });

  it('campos obrigatórios vazios: erro junto do campo, ligado por aria-describedby, sem chamar a API', async () => {
    const calls = mockApi({});
    renderDialog();
    await submit();
    expect(await screen.findByText(/mínimo de 2 letras/i)).toBeTruthy();
    expect(screen.getByText(/informe o ip da máquina/i)).toBeTruthy();
    expect(sectorField().getAttribute('aria-invalid')).toBe('true');
    const describedBy = sectorField().getAttribute('aria-describedby') ?? '';
    expect(
      describedBy
        .split(' ')
        .some((id) => document.getElementById(id)?.textContent?.match(/setor/i)),
    ).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it.each(['10.1.2', '1.2.3.4', '10.1.2.300', 'abc'])(
    'IP "%s" é recusado no formulário',
    async (ip) => {
      const calls = mockApi({});
      renderDialog();
      await userEvent.type(sectorField(), 'Saúde');
      await userEvent.type(ipField(), ip);
      await submit();
      expect(await screen.findByText(/não tem o formato esperado/i)).toBeTruthy();
      expect(calls).toHaveLength(0);
    },
  );

  it('"Não tenho acesso ao IP" desativa o campo e dispensa o IP', async () => {
    const calls = mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    renderDialog();
    await userEvent.type(sectorField(), 'Saúde');
    await userEvent.click(screen.getByRole('checkbox', { name: /não tenho acesso ao ip/i }));
    expect((ipField() as HTMLInputElement).disabled).toBe(true);
    await submit();
    await screen.findByText('Chamado nº 1000 aberto.');
    expect(calls.find((c) => c.key === CREATE_URL)?.body).toMatchObject({
      ipUnavailable: true,
      sector: 'Saúde',
    });
    expect(calls.find((c) => c.key === CREATE_URL)?.body).not.toHaveProperty('machineIp');
  });

  it('em nome de outra pessoa: nome e unidade obrigatórios, matrícula opcional', async () => {
    const calls = mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    renderDialog();
    await fillValid();
    await userEvent.click(screen.getByRole('checkbox', { name: /em nome de outra pessoa/i }));
    expect(screen.getByText('Você continua como solicitante.')).toBeTruthy();
    await submit();
    expect(await screen.findByText(/informe o nome de quem será atendido/i)).toBeTruthy();
    expect(screen.getByText(/informe a unidade ou o setor/i)).toBeTruthy();
    expect(calls).toHaveLength(0);

    await userEvent.type(screen.getByLabelText(/^Nome de quem será atendido/), 'João Souza');
    await userEvent.type(screen.getByLabelText(/^Unidade ou setor de quem/), 'Obras');
    await submit();
    await screen.findByText('Chamado nº 1000 aberto.');
    expect(calls.find((c) => c.key === CREATE_URL)?.body).toMatchObject({
      onBehalf: true,
      beneficiaryName: 'João Souza',
      beneficiarySector: 'Obras',
    });
  });
});

describe('abertura', () => {
  it('confere duplicidade, abre o chamado e avisa a tela; nome e e-mail nunca vão no corpo', async () => {
    const calls = mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    const props = renderDialog();
    await fillValid();
    await submit();

    expect(await screen.findByText('Chamado nº 1000 aberto.')).toBeTruthy();
    expect(calls.map((c) => c.key)).toEqual([CHECK_URL, CREATE_URL]);
    const create = calls[1];
    expect(create?.body).toEqual({
      sector: 'Secretaria de Saúde',
      machineIp: '10.1.2.30',
      ipUnavailable: false,
      onBehalf: false,
      testMode: false,
      duplicateOverride: false,
    });
    expect(create?.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(JSON.stringify(create?.body)).not.toMatch(/maria|prefeitura/i);
    expect(props.onCreated).toHaveBeenCalledWith(expect.objectContaining({ ticketId: '1000' }));
    expect(screen.getByRole('dialog').textContent).not.toMatch(
      /entrará em contato|já foi notificad/i,
    );
  });

  it('chamados parecidos: mostra a lista e o aviso coletivo; "Voltar" mantém o que foi digitado', async () => {
    const calls = mockApi({
      [CHECK_URL]: () =>
        json(200, {
          similar: [
            {
              ticketId: '321',
              title: 'Internet caiu no setor',
              category: 'Rede e internet',
              ageMinutes: 90,
            },
          ],
          collective: { count: 3, category: 'Rede e internet', windowHours: 2 },
        }),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    renderDialog();
    await fillValid();
    await submit();

    const dialog = await screen.findByRole('dialog', { name: 'Chamados parecidos' });
    expect(within(dialog).getByText(/Chamado nº 321: Internet caiu no setor/)).toBeTruthy();
    expect(within(dialog).getByText(/Rede e internet · há 1 h/)).toBeTruthy();
    const collective = within(dialog).getByText(
      /Identificamos 3 relatos semelhantes nas últimas 2h\./,
    );
    expect(collective.textContent).not.toMatch(/equipe|atua|resolv/i);
    expect(calls.some((c) => c.key === CREATE_URL)).toBe(false); // o aviso nunca abre sozinho

    await userEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }));
    expect((sectorField() as HTMLInputElement).value).toBe('Secretaria de Saúde');
    expect((ipField() as HTMLInputElement).value).toBe('10.1.2.30');
  });

  it('"Abrir mesmo assim" abre o chamado e informa a substituição ao servidor', async () => {
    const calls = mockApi({
      [CHECK_URL]: () =>
        json(200, {
          similar: [{ ticketId: '9', title: 'Antigo', category: null, ageMinutes: 5 }],
          collective: null,
        }),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    renderDialog();
    await fillValid();
    await submit();
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir mesmo assim' }));
    await screen.findByText('Chamado nº 1000 aberto.');
    expect(calls.find((c) => c.key === CREATE_URL)?.body).toMatchObject({
      duplicateOverride: true,
    });
  });

  it('falha na checagem de duplicidade não impede a abertura', async () => {
    const calls = mockApi({
      [CHECK_URL]: () => json(500, {}),
      [CREATE_URL]: () => json(201, SUCCESS),
    });
    renderDialog();
    await fillValid();
    await submit();
    await screen.findByText('Chamado nº 1000 aberto.');
    expect(calls.some((c) => c.key === CREATE_URL)).toBe(true);
  });

  it('modo de teste: não confere duplicidade e envia testMode', async () => {
    const calls = mockApi({ [CREATE_URL]: () => json(201, SUCCESS) });
    renderDialog({ testMode: true });
    expect(screen.getByText(/modo de teste/i)).toBeTruthy();
    await fillValid();
    await submit();
    await screen.findByText('Chamado nº 1000 aberto.');
    expect(calls.map((c) => c.key)).toEqual([CREATE_URL]);
    expect(calls[0]?.body).toMatchObject({ testMode: true });
  });
});

describe('resultados que não são sucesso', () => {
  it('falha definitiva: mensagem segura, portal e nova tentativa com chave nova', async () => {
    let attempt = 0;
    const calls = mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () =>
        ++attempt === 1
          ? json(200, {
              status: 'failed',
              ticketId: null,
              title: null,
              message:
                'O sistema de chamados está indisponível. Você pode abrir o chamado direto pelo portal.',
            })
          : json(201, SUCCESS),
    });
    renderDialog();
    await fillValid();
    await submit();

    const dialog = await screen.findByRole('dialog', { name: 'Chamado não confirmado' });
    expect(within(dialog).getByText(/o sistema de chamados está indisponível/i)).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('link', { name: /portal de chamados/i })
        .getAttribute('href'),
    ).toBe(PORTAL);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));
    await submit();
    await screen.findByText('Chamado nº 1000 aberto.');
    const keys = calls.filter((c) => c.key === CREATE_URL).map((c) => c.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('resultado desconhecido: orienta a conferir antes de repetir', async () => {
    mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () =>
        json(200, {
          status: 'unknown',
          ticketId: null,
          title: null,
          message:
            'Não conseguimos confirmar a abertura. Confira em Meus chamados antes de tentar de novo.',
        }),
    });
    renderDialog();
    await fillValid();
    await submit();
    expect(
      await screen.findByText(/confira em meus chamados antes de tentar de novo/i),
    ).toBeTruthy();
  });

  it('falha de rede: repetir usa a MESMA chave, para nunca duplicar o chamado', async () => {
    let attempt = 0;
    const calls = mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () => {
        if (++attempt === 1) throw new TypeError('network error');
        return json(200, SUCCESS);
      },
    });
    renderDialog();
    await fillValid();
    await submit();
    await screen.findByText(/não conseguimos confirmar a abertura/i);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Chamado nº 1000 aberto.');
    const keys = calls.filter((c) => c.key === CREATE_URL).map((c) => c.idempotencyKey);
    expect(keys[0]).toBeDefined();
    expect(keys[0]).toBe(keys[1]);
  });

  it.each([
    [403, /precisa entender o problema/i],
    [422, /confira os dados/i],
    [409, /já está sendo aberto/i],
  ])('recusa do servidor %i vira mensagem clara', async (status, message) => {
    mockApi({
      [CHECK_URL]: () => json(200, EMPTY_CHECK),
      [CREATE_URL]: () => json(status, { error: { code: 'X' } }),
    });
    renderDialog();
    await fillValid();
    await submit();
    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe('cancelar', () => {
  it('fecha sem chamar a API e mantém a conversa (RF-049)', async () => {
    const calls = mockApi({});
    const props = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(calls).toHaveLength(0);
  });
});
