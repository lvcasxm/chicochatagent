import { useId, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_IP_PATTERN,
  SECTOR_SUGGESTIONS,
  isValidMachineIp,
  type CreateTicketRequest,
  type CreateTicketResponse,
  type TicketCheckResponse,
} from '@chicochat/shared';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Notice } from '../../components/Notice';
import { checkTickets, createTicket, TicketRequestError } from '../../lib/tickets-api';
import { ageLabel } from '../../lib/time';

export interface TicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  /** Identidade da sessão, só para mostrar: o servidor não aceita outra. */
  requester: { name: string; email: string };
  lastSector: string | null;
  /** Conversa aberta pelo atalho de teste do administrador. */
  testMode: boolean;
  portalUrl: string | null;
  /** Chamado aberto: a tela registra o aviso na conversa. */
  onCreated: (response: CreateTicketResponse) => void;
}

type Step =
  | { name: 'form' }
  | { name: 'checking' }
  | { name: 'similar'; check: TicketCheckResponse }
  | { name: 'sending' }
  | { name: 'result'; response: CreateTicketResponse }
  | { name: 'error'; message: string };

const IP_PATTERN = new RegExp(DEFAULT_IP_PATTERN);

const newKey = () => crypto.randomUUID().replaceAll('-', '');

interface FormValues {
  sector: string;
  machineIp: string;
  ipUnavailable: boolean;
  onBehalf: boolean;
  beneficiaryName: string;
  beneficiaryRegistration: string;
  beneficiarySector: string;
}

type Errors = Partial<
  Record<'sector' | 'machineIp' | 'beneficiaryName' | 'beneficiarySector', string>
>;

function validate(values: FormValues): Errors {
  const errors: Errors = {};
  if (values.sector.trim().length < 2) errors.sector = 'Informe o seu setor (mínimo de 2 letras).';
  if (!values.ipUnavailable) {
    if (values.machineIp.trim() === '') {
      errors.machineIp = 'Informe o IP da máquina ou marque que não tem acesso a ele.';
    } else if (!isValidMachineIp(values.machineIp.trim(), IP_PATTERN)) {
      errors.machineIp = 'O IP não tem o formato esperado. Exemplo: 10.1.2.30.';
    }
  }
  if (values.onBehalf) {
    if (values.beneficiaryName.trim() === '')
      errors.beneficiaryName = 'Informe o nome de quem será atendido.';
    if (values.beneficiarySector.trim() === '')
      errors.beneficiarySector = 'Informe a unidade ou o setor.';
  }
  return errors;
}

function toRequest(
  values: FormValues,
  testMode: boolean,
  duplicateOverride: boolean,
): CreateTicketRequest {
  return {
    sector: values.sector.trim(),
    ...(values.ipUnavailable ? {} : { machineIp: values.machineIp.trim() }),
    ipUnavailable: values.ipUnavailable,
    onBehalf: values.onBehalf,
    ...(values.onBehalf
      ? {
          beneficiaryName: values.beneficiaryName.trim(),
          beneficiarySector: values.beneficiarySector.trim(),
          ...(values.beneficiaryRegistration.trim()
            ? { beneficiaryRegistration: values.beneficiaryRegistration.trim() }
            : {}),
        }
      : {}),
    testMode,
    duplicateOverride,
  };
}

/** Formulário de abertura de chamado (RF-030 a RF-049). */
export function TicketDialog(props: TicketDialogProps) {
  const { open, onOpenChange, conversationId, requester, lastSector, testMode, portalUrl } = props;
  const sectorListId = useId();
  const [step, setStep] = useState<Step>({ name: 'form' });
  const [values, setValues] = useState<FormValues>({
    sector: lastSector ?? '',
    machineIp: '',
    ipUnavailable: false,
    onBehalf: false,
    beneficiaryName: '',
    beneficiaryRegistration: '',
    beneficiarySector: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  // A chave vale por tentativa: repetir por falha de rede reaproveita a mesma, e só uma nova ação
  // da pessoa depois de um resultado definitivo gera outra.
  const key = useRef(newKey());

  const set = <K extends keyof FormValues>(name: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [name]: value }));

  const busy = step.name === 'checking' || step.name === 'sending';

  function close() {
    if (busy) return;
    onOpenChange(false);
    // Cancelar mantém a conversa e a liberação (RF-049); só o resultado final reinicia o formulário.
    if (step.name === 'result' && step.response.status === 'success') setStep({ name: 'form' });
  }

  async function submit(override: boolean) {
    setStep({ name: 'sending' });
    try {
      const response = await createTicket(
        conversationId,
        toRequest(values, testMode, override),
        key.current,
      );
      setStep({ name: 'result', response });
      if (response.status === 'success') props.onCreated(response);
    } catch (error) {
      // Sem resultado (rede) ou recusa do servidor: nada foi criado que a mesma chave não devolva.
      const message =
        error instanceof TicketRequestError && error.status === 403
          ? 'Para abrir um chamado, o ChicoChat+ primeiro precisa entender o problema. Continue a conversa.'
          : error instanceof TicketRequestError && error.status === 422
            ? 'Confira os dados do formulário e tente de novo.'
            : error instanceof TicketRequestError && error.status === 409
              ? 'Este chamado já está sendo aberto. Aguarde alguns instantes.'
              : 'Não conseguimos confirmar a abertura. Confira em Meus chamados antes de tentar de novo.';
      setStep({ name: 'error', message });
    }
  }

  async function onSubmit() {
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (testMode) return submit(false);

    setStep({ name: 'checking' });
    const check = await checkTickets(conversationId);
    if (check.similar.length > 0 || check.collective) {
      setStep({ name: 'similar', check });
      return;
    }
    return submit(false);
  }

  function retryWithNewAttempt() {
    key.current = newKey();
    setStep({ name: 'form' });
  }

  let title = 'Abrir chamado';
  let description: ReactNode = (
    <p>
      Revise os dados e informe o seu setor e o IP da máquina.{testMode ? ' Modo de teste.' : ''}
    </p>
  );
  let body: ReactNode;
  let footer: ReactNode;

  if (step.name === 'similar') {
    title = 'Chamados parecidos';
    description = <p>Antes de abrir outro, veja se algum destes já resolve a sua situação.</p>;
    body = (
      <div className="flex flex-col gap-4">
        {step.check.similar.length > 0 && (
          <ul className="flex flex-col border-t border-border">
            {step.check.similar.map((ticket) => (
              <li key={ticket.ticketId} className="border-b border-border py-3">
                <p className="type-label">
                  Chamado nº {ticket.ticketId}: {ticket.title}
                </p>
                <p className="type-small text-fg-muted">
                  {ticket.category ? `${ticket.category} · ` : ''}
                  {ageLabel(ticket.ageMinutes) ?? 'há mais de uma semana'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {step.check.collective && (
          <Notice tone="neutral">
            Identificamos {step.check.collective.count} relatos semelhantes nas últimas{' '}
            {step.check.collective.windowHours}h.
          </Notice>
        )}
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep({ name: 'form' })}>
          Voltar
        </Button>
        <Button onClick={() => void submit(true)}>Abrir mesmo assim</Button>
      </>
    );
  } else if (step.name === 'result') {
    const { response } = step;
    title = response.status === 'success' ? 'Chamado aberto' : 'Chamado não confirmado';
    description = undefined;
    body = (
      <div className="flex flex-col gap-4">
        <Notice tone={response.status === 'success' ? 'neutral' : 'danger'}>
          {response.message}
        </Notice>
        {response.status !== 'success' && portalUrl && (
          <p>
            <a href={portalUrl} target="_blank" rel="noopener noreferrer">
              Abrir o portal de chamados
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          </p>
        )}
      </div>
    );
    footer =
      response.status === 'success' ? (
        <Button onClick={close}>Fechar</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={close}>
            Fechar
          </Button>
          <Button variant="outline" onClick={retryWithNewAttempt}>
            Tentar novamente
          </Button>
        </>
      );
  } else if (step.name === 'error') {
    title = 'Não foi possível abrir o chamado';
    description = undefined;
    body = <Notice tone="danger">{step.message}</Notice>;
    footer = (
      <>
        <Button variant="ghost" onClick={close}>
          Fechar
        </Button>
        {/* Mesma chave: se o chamado chegou a ser criado, o servidor devolve o mesmo resultado. */}
        <Button variant="outline" onClick={() => void submit(false)}>
          Tentar novamente
        </Button>
      </>
    );
  } else {
    body = (
      <form
        id="ticket-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
        className="flex flex-col gap-6"
      >
        <div className="type-small rounded-lg bg-surface p-4">
          <p className="type-label">Solicitante</p>
          <p>{requester.name}</p>
          <p className="text-fg-muted">{requester.email}</p>
        </div>

        <Field
          label="Seu setor"
          hint="Escolha uma sugestão ou escreva o seu setor."
          error={errors.sector}
        >
          <Input
            list={sectorListId}
            value={values.sector}
            maxLength={120}
            onChange={(event) => set('sector', event.target.value)}
          />
        </Field>
        <datalist id={sectorListId}>
          {SECTOR_SUGGESTIONS.map((sector) => (
            <option key={sector} value={sector} />
          ))}
        </datalist>

        <div className="flex flex-col gap-2">
          <Field
            label="IP da máquina"
            hint="Para descobrir o IP, na área de trabalho, clique duas vezes no arquivo MostrarIP.bat."
            error={errors.machineIp}
            required={!values.ipUnavailable}
          >
            <Input
              value={values.machineIp}
              disabled={values.ipUnavailable}
              inputMode="decimal"
              maxLength={20}
              placeholder="Ex.: 10.1.2.30"
              onChange={(event) => set('machineIp', event.target.value)}
            />
          </Field>
          <Checkbox
            label="Não tenho acesso ao IP (computador não liga / sem acesso à máquina)"
            checked={values.ipUnavailable}
            onChange={(event) => set('ipUnavailable', event.target.checked)}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Checkbox
            label="Estou abrindo um chamado em nome de outra pessoa"
            checked={values.onBehalf}
            onChange={(event) => set('onBehalf', event.target.checked)}
          />
          {values.onBehalf && (
            <>
              <p className="type-small text-fg-muted">Você continua como solicitante.</p>
              <Field label="Nome de quem será atendido" error={errors.beneficiaryName}>
                <Input
                  value={values.beneficiaryName}
                  maxLength={120}
                  onChange={(event) => set('beneficiaryName', event.target.value)}
                />
              </Field>
              <Field label="Matrícula" required={false}>
                <Input
                  value={values.beneficiaryRegistration}
                  maxLength={40}
                  onChange={(event) => set('beneficiaryRegistration', event.target.value)}
                />
              </Field>
              <Field
                label="Unidade ou setor de quem será atendido"
                error={errors.beneficiarySector}
              >
                <Input
                  value={values.beneficiarySector}
                  maxLength={120}
                  onChange={(event) => set('beneficiarySector', event.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      </form>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={close} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" form="ticket-form" loading={busy}>
          {busy ? 'Abrindo…' : 'Abrir chamado'}
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={title}
      description={description}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
