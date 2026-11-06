import { useRef, useState } from 'react';
import type { InstructionVersion, InstructionsState } from '@chicochat/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { Textarea } from '../../components/Input';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import {
  fetchInstructionVersion,
  fetchInstructions,
  proposeInstructions,
  publishInstructions,
  rehearse,
  restoreInstructions,
  saveInstructionsDraft,
} from '../../lib/admin-api';
import { cx } from '../../lib/cx';
import { collapseDiff, diffLines, hasChanges, type DiffItem } from '../../lib/diff';
import { formatDateTime } from '../../lib/time';
import { AdminLayout } from './AdminLayout';
import { errorText, LoadError, LoadingBlock, Section } from './ui';
import { useLoad } from './useLoad';

type View = 'compare' | 'edit' | 'rehearse';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'compare', label: 'Comparar com o que está em uso' },
  { id: 'edit', label: 'Editar o texto' },
  { id: 'rehearse', label: 'Ensaiar' },
];

/** Antes e depois, linha a linha. O sinal e o texto dizem o que mudou; a cor só reforça. */
function Diff({ before, after }: { before: string; after: string }) {
  const [showAll, setShowAll] = useState(false);
  const lines = diffLines(before, after);
  if (!hasChanges(lines)) {
    return <Notice>O rascunho está igual ao texto em uso.</Notice>;
  }
  const items: DiffItem[] = showAll ? lines : collapseDiff(lines);
  const hidden = items.reduce((sum, item) => sum + (item.kind === 'gap' ? item.count : 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Diferenças entre o texto em uso e o rascunho"
        className="type-small max-h-[32rem] overflow-auto rounded-lg border border-border"
      >
        {items.map((item, index) =>
          item.kind === 'gap' ? (
            <div key={index} className="type-caption bg-surface px-3 py-1 text-fg-muted">
              {item.count === 1 ? '1 linha sem mudança' : `${item.count} linhas sem mudança`}
            </div>
          ) : (
            <div
              key={index}
              className={cx(
                'flex gap-3 px-3 py-1 break-words whitespace-pre-wrap',
                item.kind === 'added' && 'bg-accent-soft',
                item.kind === 'removed' && 'bg-danger-soft line-through decoration-1',
              )}
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-fg-muted">
                {item.kind === 'added' ? '+' : item.kind === 'removed' ? '−' : ''}
              </span>
              <span className="sr-only">
                {item.kind === 'added'
                  ? 'Acrescentado: '
                  : item.kind === 'removed'
                    ? 'Removido: '
                    : ''}
              </span>
              <span>{item.text === '' ? ' ' : item.text}</span>
            </div>
          ),
        )}
      </div>
      {(hidden > 0 || showAll) && (
        <div>
          <Button variant="ghost" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Mostrar só o que mudou' : 'Mostrar o texto inteiro'}
          </Button>
        </div>
      )}
    </div>
  );
}

function Editor({
  draft,
  maxLength,
  onSaved,
  onDirty,
}: {
  draft: InstructionVersion;
  maxLength: number;
  onSaved: (version: InstructionVersion) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [text, setText] = useState(draft.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== draft.content;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveInstructionsDraft(text);
      onDirty(false);
      onSaved(saved);
    } catch (failure) {
      setError(
        errorText(
          failure,
          'Não foi possível salvar. Confira se o texto não está vazio, não passa do limite e não tem marcadores como <<...>>.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Texto do rascunho"
        required={false}
        hideOptionalMark
        hint="Escreva em português claro, como se orientasse um colega novo da equipe. As regras de segurança e de formato são fixas e não ficam aqui."
        className="max-w-none"
      >
        <Textarea
          value={text}
          rows={18}
          maxLength={maxLength}
          className="min-h-96 font-mono"
          onChange={(event) => {
            setText(event.target.value);
            onDirty(event.target.value !== draft.content);
          }}
        />
      </Field>
      <p className="type-small text-fg-muted">
        {text.length.toLocaleString('pt-BR')} de {maxLength.toLocaleString('pt-BR')} caracteres.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div>
        <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
          Salvar o rascunho
        </Button>
      </div>
    </div>
  );
}

interface RehearsalMessage {
  role: 'user' | 'assistant';
  content: string;
  notices: string[];
}

const MARKER_NOTICE = {
  resolution_attempt: 'Aqui o agente registraria uma tentativa de resolução.',
  open_ticket_form: 'Aqui o formulário de chamado seria liberado para a pessoa.',
} as const;

/** Chat de ensaio: usa o rascunho. Nada é gravado, nenhum chamado é aberto e as métricas não mudam. */
function Rehearsal() {
  const [messages, setMessages] = useState<RehearsalMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: 'user' as const, content: text, notices: [] }];
    setMessages([...history, { role: 'assistant', content: '', notices: [] }]);
    setInput('');
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    const update = (change: (reply: RehearsalMessage) => RehearsalMessage) =>
      setMessages((current) => {
        const last = current.at(-1);
        return last ? [...current.slice(0, -1), change(last)] : current;
      });
    try {
      for await (const event of rehearse(
        history.map(({ role, content }) => ({ role, content })),
        controller.signal,
      )) {
        if (event.event === 'delta') {
          update((reply) => ({ ...reply, content: reply.content + event.data.text }));
        } else if (event.event === 'marker') {
          update((reply) => ({
            ...reply,
            notices: [...reply.notices, MARKER_NOTICE[event.data.kind]],
          }));
        } else if (event.event === 'error') {
          setError(event.data.message);
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(errorText(failure, 'Não foi possível ensaiar agora. Tente novamente.'));
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice>
        O ensaio usa o rascunho, não o texto em uso. Nada é gravado: não cria conversa, não abre
        chamado e não entra nas métricas.
      </Notice>
      <ol aria-live="polite" className="flex flex-col gap-3">
        {messages.map((message, index) => (
          <li
            key={index}
            className={cx(
              'flex max-w-reading flex-col gap-2 rounded-lg p-4',
              message.role === 'user' ? 'self-end bg-accent-soft' : 'bg-surface',
            )}
          >
            <span className="type-small text-fg-muted">
              {message.role === 'user' ? 'Você (como servidor)' : 'ChicoChat+ (rascunho)'}
            </span>
            <p className="type-body break-words whitespace-pre-wrap">
              {message.content || (busy && index === messages.length - 1 ? 'Escrevendo…' : '')}
            </p>
            {message.notices.map((notice) => (
              <p key={notice} className="type-small rounded-tag bg-warning-soft px-3 py-2">
                {notice}
              </p>
            ))}
          </li>
        ))}
      </ol>
      {error && <Notice tone="danger">{error}</Notice>}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Field
          label="Mensagem para o agente"
          required={false}
          hideOptionalMark
          className="max-w-none"
        >
          <Textarea
            value={input}
            rows={3}
            maxLength={2000}
            onChange={(event) => setInput(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} disabled={input.trim() === ''}>
            Enviar
          </Button>
          <Button
            variant="ghost"
            disabled={messages.length === 0}
            onClick={() => {
              abort.current?.abort();
              setMessages([]);
              setError(null);
            }}
          >
            Limpar o ensaio
          </Button>
        </div>
      </form>
    </div>
  );
}

function History({
  state,
  onRestored,
}: {
  state: InstructionsState;
  onRestored: (draft: InstructionVersion) => void;
}) {
  const [shown, setShown] = useState<InstructionVersion | null>(null);
  const [loadingVersion, setLoadingVersion] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(version: number) {
    setLoadingVersion(version);
    setError(null);
    try {
      setShown(await fetchInstructionVersion(version));
    } catch {
      setError('Não foi possível abrir esta versão.');
    } finally {
      setLoadingVersion(null);
    }
  }

  async function restore(version: number) {
    setError(null);
    try {
      onRestored(await restoreInstructions(version));
      setConfirm(null);
    } catch (failure) {
      setConfirm(null);
      setError(errorText(failure, 'Não foi possível restaurar esta versão.'));
    }
  }

  return (
    <Section title="Histórico de versões">
      {error && <Notice tone="danger">{error}</Notice>}
      <ul className="flex flex-col border-t border-border">
        {state.history.map((item) => (
          <li
            key={item.version}
            className="flex flex-wrap items-start justify-between gap-4 border-b border-border py-4"
          >
            <div className="flex min-w-0 max-w-reading flex-col gap-1">
              <span className="type-label">
                Versão {item.version}
                {item.status === 'published' ? ' · em uso' : ''}
              </span>
              <span className="type-small text-fg-muted">
                {item.publishedAt
                  ? `Publicada em ${formatDateTime(item.publishedAt)}`
                  : 'Não publicada'}
                {item.publishedBy ? ` por ${item.publishedBy.name}` : ''}
              </span>
              {item.changeRequest && (
                <span className="type-small">Pedido: {item.changeRequest}</span>
              )}
              {item.changeSummary && <span className="type-small">{item.changeSummary}</span>}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                loading={loadingVersion === item.version}
                onClick={() => void open(item.version)}
              >
                Ver o texto
              </Button>
              {item.status !== 'published' && (
                <Button variant="ghost" onClick={() => setConfirm(item.version)}>
                  Restaurar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={shown !== null}
        onOpenChange={(open) => !open && setShown(null)}
        title={shown ? `Versão ${shown.version}` : ''}
        footer={<Button onClick={() => setShown(null)}>Fechar</Button>}
      >
        {shown && (
          <pre className="type-small max-h-96 overflow-auto rounded-lg bg-surface p-4 break-words whitespace-pre-wrap">
            {shown.content}
          </pre>
        )}
      </Dialog>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Restaurar a versão ${confirm ?? ''}?`}
        description={
          state.draft
            ? 'O rascunho atual será substituído pelo texto desta versão. O que está em uso não muda até você publicar.'
            : 'Será criado um rascunho com o texto desta versão. O que está em uso não muda até você publicar.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button onClick={() => confirm !== null && void restore(confirm)}>
              Criar o rascunho
            </Button>
          </>
        }
      />
    </Section>
  );
}

function Workspace({ initial, reload }: { initial: InstructionsState; reload: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  const [view, setView] = useState<View>('compare');
  const [request, setRequest] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const draft = state.draft;
  const setDraft = (value: InstructionVersion) =>
    setState((current) => ({ ...current, draft: value }));

  async function propose() {
    setProposing(true);
    setProposeError(null);
    try {
      setDraft(await proposeInstructions(request.trim()));
      setRequest('');
      setView('compare');
    } catch (failure) {
      setProposeError(
        errorText(failure, 'Não foi possível pedir à IA agora. Você pode editar o texto à mão.'),
      );
    } finally {
      setProposing(false);
    }
  }

  async function startFromPublished() {
    setProposeError(null);
    try {
      setDraft(await saveInstructionsDraft(state.published.content));
      setView('edit');
    } catch (failure) {
      setProposeError(errorText(failure, 'Não foi possível criar o rascunho.'));
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await publishInstructions(draft.version);
      setConfirmPublish(false);
      toast({
        title: `Versão ${draft.version} publicada`,
        description: 'O agente passa a seguir este texto a partir da próxima mensagem.',
      });
      setDirty(false);
      reload();
    } catch (failure) {
      setConfirmPublish(false);
      setPublishError(
        errorText(failure, 'Não foi possível publicar. Recarregue a página e confira o rascunho.'),
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-12">
      <Section title="Em uso agora">
        <p className="type-body max-w-reading">
          <strong>Versão {state.published.version}</strong>
          {state.published.publishedAt
            ? `, publicada em ${formatDateTime(state.published.publishedAt)}`
            : ''}
          {state.published.publishedBy ? ` por ${state.published.publishedBy.name}` : ''}. É este
          texto que orienta o agente em cada atendimento.
        </p>
        <details>
          <summary className="type-small cursor-pointer">Ler o texto em uso</summary>
          <pre className="type-small mt-3 max-h-96 overflow-auto rounded-lg bg-surface p-4 break-words whitespace-pre-wrap">
            {state.published.content}
          </pre>
        </details>
      </Section>

      <Section title="Pedir uma mudança">
        <p className="type-body max-w-reading text-fg-muted">
          Descreva o que quer mudar, com as suas palavras. A IA devolve uma proposta de texto, que
          fica como <strong>rascunho</strong>: nada muda para os servidores até você publicar.
        </p>
        {!state.aiAvailable && (
          <Notice tone="warning">
            A IA não está configurada. Você ainda pode editar o texto à mão e publicar.
          </Notice>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void propose();
          }}
        >
          <Field
            label="O que deve mudar?"
            required={false}
            hideOptionalMark
            hint="Exemplo: “Quando o problema for impressora, pergunte antes o número do patrimônio.”"
            className="max-w-none"
          >
            <Textarea
              value={request}
              rows={4}
              maxLength={2000}
              onChange={(event) => setRequest(event.target.value)}
            />
          </Field>
          {proposeError && <Notice tone="danger">{proposeError}</Notice>}
          <div>
            <Button
              type="submit"
              loading={proposing}
              disabled={!state.aiAvailable || request.trim() === ''}
            >
              {proposing ? 'Pedindo à IA…' : draft ? 'Pedir um novo ajuste' : 'Pedir à IA'}
            </Button>
          </div>
          {draft && (
            <p className="type-small text-fg-muted">
              O novo ajuste parte do rascunho atual, não do texto em uso.
            </p>
          )}
        </form>
      </Section>

      {draft ? (
        <Section title={`Rascunho (versão ${draft.version})`}>
          <p className="type-body max-w-reading text-fg-muted">
            Ainda não está em uso. Confira, ensaie e só então publique.
          </p>
          {draft.changeRequest && (
            <p className="type-small max-w-reading">
              <strong>Pedido:</strong> {draft.changeRequest}
            </p>
          )}
          {draft.changeSummary && (
            <Notice>
              <strong>O que mudou:</strong> {draft.changeSummary}
            </Notice>
          )}
          {draft.conflicts.length > 0 && (
            <Notice tone="warning">
              <p className="type-label">Pontos de atenção</p>
              <ul className="mt-2 list-disc pl-5">
                {draft.conflicts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Notice>
          )}
          {draft.questions.length > 0 && (
            <Notice tone="warning">
              <p className="type-label">A IA precisa saber</p>
              <ul className="mt-2 list-disc pl-5">
                {draft.questions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="type-small mt-2">
                Responda editando o texto ou pedindo um novo ajuste acima.
              </p>
            </Notice>
          )}

          <div role="group" aria-label="Como ver o rascunho" className="flex flex-wrap gap-2">
            {VIEWS.map((option) => (
              <Button
                key={option.id}
                variant={view === option.id ? 'primary' : 'outline'}
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {view === 'compare' && <Diff before={state.published.content} after={draft.content} />}
          {view === 'edit' && (
            <Editor
              key={`${draft.version}:${draft.content.length}:${draft.changeSummary ?? ''}`}
              draft={draft}
              maxLength={state.maxLength}
              onSaved={setDraft}
              onDirty={setDirty}
            />
          )}
          {view === 'rehearse' && <Rehearsal />}

          {publishError && <Notice tone="danger">{publishError}</Notice>}
          <div className="flex flex-col items-start gap-2">
            <Button disabled={dirty} onClick={() => setConfirmPublish(true)}>
              Publicar o rascunho
            </Button>
            {dirty && (
              <p className="type-small text-fg-muted">Salve as edições antes de publicar.</p>
            )}
          </div>

          <Dialog
            open={confirmPublish}
            onOpenChange={setConfirmPublish}
            title={`Publicar a versão ${draft.version}?`}
            description="A partir da próxima mensagem dos servidores, o agente passa a seguir este texto. Dá para voltar a uma versão anterior pelo histórico."
            footer={
              <>
                <Button variant="ghost" onClick={() => setConfirmPublish(false)}>
                  Cancelar
                </Button>
                <Button loading={publishing} onClick={() => void publish()}>
                  Publicar
                </Button>
              </>
            }
          />
        </Section>
      ) : (
        <Notice>
          Não há rascunho. Peça uma mudança acima ou{' '}
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => void startFromPublished()}
          >
            comece a editar o texto em uso
          </button>
          .
        </Notice>
      )}

      <History
        state={state}
        onRestored={(restored) => {
          setDraft(restored);
          setView('compare');
        }}
      />
    </div>
  );
}

export function InstructionsPage() {
  const { state, reload } = useLoad(fetchInstructions, 'instrucoes');

  return (
    <AdminLayout title="Instruções do agente">
      <p className="type-body max-w-reading text-fg-muted">
        Este texto diz ao agente como atender: assuntos, responsáveis e encaminhamentos. As regras
        de segurança, de formato e de abertura de chamado não ficam aqui: são fixas e não podem ser
        mudadas por este texto.
      </p>
      {state.status === 'loading' && <LoadingBlock label="Carregando as instruções…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar as instruções" onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <Workspace
          key={`${state.data.published.version}:${state.data.draft?.version ?? 0}`}
          initial={state.data}
          reload={reload}
        />
      )}
    </AdminLayout>
  );
}
