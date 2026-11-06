import { useState, type FormEvent } from 'react';
import { USER_ROLES, type AdminUser, type UserRole } from '@chicochat/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Notice } from '../../components/Notice';
import { Select } from '../../components/Select';
import {
  changeUserRole,
  fetchAdminUsers,
  fetchAudit,
  fetchEffectivePrompt,
} from '../../lib/admin-api';
import { formatDateTime } from '../../lib/time';
import { AdminLayout } from './AdminLayout';
import { errorText, LoadError, LoadingBlock, Pagination } from './ui';
import { useLoad } from './useLoad';

const ROLE_LABEL: Record<UserRole, string> = {
  user: 'Servidor',
  tecnico: 'Técnico (lê transcrições)',
  admin: 'Administrador',
};

/** Prompt que o agente recebe, somente leitura (RF-084). */
export function PromptPage() {
  const { state, reload } = useLoad(fetchEffectivePrompt, 'prompt');

  return (
    <AdminLayout title="Prompt efetivo">
      <p className="type-body max-w-reading text-fg-muted">
        É exatamente o texto que o agente recebe a cada atendimento: as regras fixas do sistema, a
        regra de prioridade e as instruções em uso. Só leitura. Para mudar as instruções, use a aba
        “Instruções do agente”.
      </p>
      {state.status === 'loading' && <LoadingBlock label="Carregando o prompt…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar o prompt" onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <div className="flex flex-col gap-8">
          <dl className="type-small grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">Instruções em uso</dt>
            <dd>Versão {state.data.instructionsVersion}</dd>
            <dt className="text-fg-muted">Identificador do prompt</dt>
            <dd className="break-all">
              <code>{state.data.version}</code>
            </dd>
          </dl>
          <section className="flex flex-col gap-3">
            <h2 className="type-title-3">Para os servidores</h2>
            <pre className="type-small max-h-[36rem] overflow-auto rounded-lg bg-surface p-4 break-words whitespace-pre-wrap">
              {state.data.text}
            </pre>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="type-title-3">Acréscimo só para administradores</h2>
            <pre className="type-small overflow-auto rounded-lg bg-surface p-4 break-words whitespace-pre-wrap">
              {state.data.adminExtra}
            </pre>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}

export function UsersPage() {
  const [draft, setDraft] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { state, reload } = useLoad(() => fetchAdminUsers(term, page), `${term}|${page}`);
  const [pending, setPending] = useState<{ user: AdminUser; role: UserRole } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'neutral' | 'danger'; text: string } | null>(null);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setTerm(draft.trim());
  }

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    try {
      await changeUserRole(pending.user.id, pending.role);
      setMessage({
        tone: 'neutral',
        text: `${pending.user.fullName} agora é ${ROLE_LABEL[pending.role].toLowerCase()}.`,
      });
      reload();
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: errorText(error, 'Não foi possível mudar o papel. Tente novamente.'),
      });
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  return (
    <AdminLayout title="Usuários e papéis">
      <p className="type-body max-w-reading text-fg-muted">
        A pessoa aparece aqui depois do primeiro acesso com a conta institucional. O sistema sempre
        mantém ao menos um administrador. Toda mudança fica na auditoria.
      </p>
      <form onSubmit={search} role="search" className="flex flex-wrap items-end gap-3">
        <Field label="Buscar" required={false} hideOptionalMark hint="Nome ou e-mail.">
          <Input
            type="search"
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {state.status === 'loading' && <LoadingBlock label="Carregando os usuários…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar os usuários" onRetry={reload} />
      )}
      {state.status === 'ready' &&
        (state.data.users.length === 0 ? (
          <EmptyState title="Ninguém encontrado" description="Tente outro nome ou e-mail." />
        ) : (
          <div className="flex flex-col gap-6">
            <ul className="flex flex-col border-t border-border">
              {state.data.users.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="type-label">
                      {user.fullName}
                      {user.disabled && ' (desativado)'}
                    </span>
                    <span className="type-small text-fg-muted">
                      {user.email} ·{' '}
                      {user.lastLoginAt
                        ? `último acesso em ${formatDateTime(user.lastLoginAt)}`
                        : 'nunca entrou'}
                    </span>
                  </div>
                  <Field
                    label={`Papel de ${user.fullName}`}
                    required={false}
                    hideOptionalMark
                    className="max-w-72"
                  >
                    <Select
                      value={user.role}
                      onValueChange={(role) =>
                        role !== user.role && setPending({ user, role: role as UserRole })
                      }
                      options={USER_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
                    />
                  </Field>
                </li>
              ))}
            </ul>
            <Pagination page={page} hasMore={state.data.hasMore} onPage={setPage} />
          </div>
        ))}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Mudar o papel?"
        description={
          pending
            ? `${pending.user.fullName} passará de “${ROLE_LABEL[pending.user.role]}” para “${ROLE_LABEL[pending.role]}”. A mudança vale já na próxima ação da pessoa.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={() => void confirm()}>
              Confirmar
            </Button>
          </>
        }
      />
    </AdminLayout>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'conversation.read': 'Leitura de conversa',
  'export.created': 'Exportação de dados',
  'insights.generated': 'Análise por IA',
  'instructions.published': 'Instruções publicadas',
  'instructions.restored_to_draft': 'Versão restaurada como rascunho',
  'user.role_changed': 'Papel alterado',
  'category.created': 'Card criado',
  'category.updated': 'Card alterado',
  'category.deleted': 'Card apagado',
};

export function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { state, reload } = useLoad(() => fetchAudit(action, page), `${action}|${page}`);

  return (
    <AdminLayout title="Auditoria">
      <p className="type-body max-w-reading text-fg-muted">
        Registro das ações sensíveis feitas na administração. Ele só cresce: ninguém edita nem apaga
        registros por aqui.
      </p>
      <Field label="Tipo de ação" required={false} hideOptionalMark className="max-w-72">
        <Select
          value={action === '' ? 'all' : action}
          onValueChange={(value) => {
            setPage(1);
            setAction(value === 'all' ? '' : value);
          }}
          options={[
            { value: 'all', label: 'Todas' },
            ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
      </Field>
      {state.status === 'loading' && <LoadingBlock label="Carregando a auditoria…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar a auditoria" onRetry={reload} />
      )}
      {state.status === 'ready' &&
        (state.data.entries.length === 0 ? (
          <EmptyState title="Nenhum registro" description="Ainda não há ações deste tipo." />
        ) : (
          <div className="flex flex-col gap-6">
            <ul className="flex flex-col border-t border-border">
              {state.data.entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 border-b border-border py-4">
                  <span className="type-label">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                  <span className="type-small text-fg-muted">
                    {formatDateTime(entry.createdAt)} · {entry.actorName ?? 'Sistema'}
                    {entry.targetType ? ` · ${entry.targetType}` : ''}
                  </span>
                  {Object.keys(entry.metadata).length > 0 && (
                    <span className="type-small text-fg-muted">
                      {Object.entries(entry.metadata)
                        .map(([key, value]) => `${key}: ${String(value)}`)
                        .join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={page} hasMore={state.data.hasMore} onPage={setPage} />
          </div>
        ))}
    </AdminLayout>
  );
}
