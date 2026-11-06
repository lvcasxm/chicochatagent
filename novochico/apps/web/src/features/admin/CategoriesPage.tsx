import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  type AdminCategory,
} from '@chicochat/shared';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { Input, Textarea } from '../../components/Input';
import { Notice } from '../../components/Notice';
import { Select } from '../../components/Select';
import {
  createAdminCategory,
  deleteAdminCategory,
  fetchAdminCategories,
  updateAdminCategory,
} from '../../lib/admin-api';
import { AdminLayout } from './AdminLayout';
import { errorText, LoadError, LoadingBlock } from './ui';
import { useLoad } from './useLoad';

const ACTION_LABEL = {
  chat: 'Abre uma conversa',
  external_link: 'Abre um link',
  hidden: 'Oculto',
} as const;

interface Form {
  key: string;
  title: string;
  cardDescription: string;
  icon: string;
  action: AdminCategory['action'];
  externalUrl: string;
  secondaryLinkLabel: string;
  secondaryLinkUrl: string;
  cannedMessage: string;
  shortLabel: string;
  sortOrder: string;
  active: boolean;
}

const EMPTY: Form = {
  key: '',
  title: '',
  cardDescription: '',
  icon: '',
  action: 'chat',
  externalUrl: '',
  secondaryLinkLabel: '',
  secondaryLinkUrl: '',
  cannedMessage: '',
  shortLabel: '',
  sortOrder: '100',
  active: true,
};

const fromCategory = (category: AdminCategory): Form => ({
  key: category.key,
  title: category.title,
  cardDescription: category.cardDescription ?? '',
  icon: category.icon ?? '',
  action: category.action,
  externalUrl: category.externalUrl ?? '',
  secondaryLinkLabel: category.secondaryLinkLabel ?? '',
  secondaryLinkUrl: category.secondaryLinkUrl ?? '',
  cannedMessage: category.cannedMessage ?? '',
  shortLabel: category.shortLabel ?? '',
  sortOrder: String(category.sortOrder),
  active: category.active,
});

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function toPayload(form: Form) {
  return {
    title: form.title,
    cardDescription: orNull(form.cardDescription),
    icon: orNull(form.icon),
    action: form.action,
    externalUrl: form.action === 'external_link' ? orNull(form.externalUrl) : null,
    secondaryLinkLabel: orNull(form.secondaryLinkLabel),
    secondaryLinkUrl: orNull(form.secondaryLinkUrl),
    cannedMessage: form.action === 'chat' ? orNull(form.cannedMessage) : null,
    shortLabel: form.action === 'chat' ? orNull(form.shortLabel) : null,
    sortOrder: Number(form.sortOrder),
    active: form.active,
  };
}

const FIELD_MESSAGE: Record<string, string> = {
  key: 'Use letras minúsculas, números, hífen ou _ (2 a 40 caracteres), começando por letra.',
  title: 'Informe um título de até 80 caracteres.',
  cardDescription: 'A descrição passa de 200 caracteres.',
  icon: 'Use só o nome do ícone, com letras e números (ex.: Monitor).',
  externalUrl: 'Informe um endereço completo, começando com http:// ou https://.',
  secondaryLinkUrl: 'Informe um endereço completo, começando com http:// ou https://.',
  secondaryLinkLabel: 'O rótulo passa de 60 caracteres.',
  cannedMessage: 'A mensagem pronta passa de 600 caracteres.',
  shortLabel: 'O rótulo curto passa de 40 caracteres.',
  sortOrder: 'Informe um número inteiro entre 0 e 10000.',
};

function validate(form: Form, creating: boolean): { errors: Record<string, string>; ok: boolean } {
  const payload = toPayload(form);
  const result = creating
    ? createCategoryRequestSchema.safeParse({ key: form.key, ...payload })
    : updateCategoryRequestSchema.safeParse(payload);
  if (result.success) return { errors: {}, ok: true };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = String(issue.path[0] ?? '');
    if (path in errors) continue;
    // Mensagens escritas por nós (em português) valem; as padrão do zod são trocadas.
    errors[path] =
      issue.code === 'custom' ? issue.message : (FIELD_MESSAGE[path] ?? 'Valor inválido.');
  }
  return { errors, ok: false };
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: AdminCategory | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const creating = category === 'new';
  const [form, setForm] = useState<Form>(creating ? EMPTY : fromCategory(category));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof Form>(name: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [name]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const check = validate(form, creating);
    setErrors(check.errors);
    if (!check.ok) return;
    setSaving(true);
    setFailure(null);
    try {
      const payload = toPayload(form);
      if (creating) {
        await createAdminCategory({ key: form.key, ...payload });
      } else {
        await updateAdminCategory(category.id, payload);
      }
      onSaved();
    } catch (error) {
      setFailure(errorText(error, 'Não foi possível salvar o card. Tente novamente.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={creating ? 'Novo card' : `Editar: ${category.title}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="card-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="card-form"
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex flex-col gap-5"
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        {creating && (
          <Field
            label="Identificador"
            hint="Usado internamente e nas métricas. Não muda depois."
            error={errors.key}
          >
            <Input value={form.key} onChange={(event) => set('key', event.target.value)} />
          </Field>
        )}
        <Field label="Título" error={errors.title}>
          <Input value={form.title} onChange={(event) => set('title', event.target.value)} />
        </Field>
        <Field label="Descrição" required={false} error={errors.cardDescription}>
          <Input
            value={form.cardDescription}
            onChange={(event) => set('cardDescription', event.target.value)}
          />
        </Field>
        <Field
          label="Ícone"
          required={false}
          hint="Nome do ícone, como Monitor ou Mail."
          error={errors.icon}
        >
          <Input value={form.icon} onChange={(event) => set('icon', event.target.value)} />
        </Field>
        <Field label="O que o card faz">
          <Select
            value={form.action}
            onValueChange={(value) => set('action', value as Form['action'])}
            options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        {form.action === 'external_link' && (
          <Field label="Endereço do link" error={errors.externalUrl}>
            <Input
              type="url"
              value={form.externalUrl}
              onChange={(event) => set('externalUrl', event.target.value)}
            />
          </Field>
        )}
        {form.action === 'chat' && (
          <>
            <Field
              label="Mensagem pronta"
              required={false}
              hint="Enviada ao clicar no card."
              error={errors.cannedMessage}
            >
              <Textarea
                value={form.cannedMessage}
                rows={3}
                onChange={(event) => set('cannedMessage', event.target.value)}
              />
            </Field>
            <Field
              label="Rótulo curto"
              required={false}
              hint="Título provisório da conversa."
              error={errors.shortLabel}
            >
              <Input
                value={form.shortLabel}
                onChange={(event) => set('shortLabel', event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Link secundário: rótulo" required={false} error={errors.secondaryLinkLabel}>
          <Input
            value={form.secondaryLinkLabel}
            onChange={(event) => set('secondaryLinkLabel', event.target.value)}
          />
        </Field>
        <Field label="Link secundário: endereço" required={false} error={errors.secondaryLinkUrl}>
          <Input
            type="url"
            value={form.secondaryLinkUrl}
            onChange={(event) => set('secondaryLinkUrl', event.target.value)}
          />
        </Field>
        <Field label="Ordem" hint="Números menores aparecem primeiro." error={errors.sortOrder}>
          <Input
            inputMode="numeric"
            value={form.sortOrder}
            onChange={(event) => set('sortOrder', event.target.value)}
          />
        </Field>
        <Checkbox
          label="Ativo (aparece na tela inicial)"
          checked={form.active}
          onChange={(event) => set('active', event.target.checked)}
        />
      </form>
    </Dialog>
  );
}

export function CategoriesPage() {
  const { state, reload } = useLoad(fetchAdminCategories, 'categorias');
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);
  const [removing, setRemoving] = useState<AdminCategory | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function remove(category: AdminCategory) {
    setRemoveError(null);
    try {
      await deleteAdminCategory(category.id);
      setRemoving(null);
      reload();
    } catch (error) {
      setRemoving(null);
      setRemoveError(errorText(error, 'Não foi possível apagar o card.'));
    }
  }

  return (
    <AdminLayout title="Cards da tela inicial">
      <p className="type-body max-w-reading text-fg-muted">
        São os atalhos que as pessoas veem ao abrir o ChicoChat+. Desativar esconde o card sem
        apagá-lo. Conversas antigas não são afetadas.
      </p>
      <div>
        <Button iconStart={<Plus className="size-5" />} onClick={() => setEditing('new')}>
          Novo card
        </Button>
      </div>
      {removeError && <Notice tone="danger">{removeError}</Notice>}
      {state.status === 'loading' && <LoadingBlock label="Carregando os cards…" />}
      {state.status === 'error' && (
        <LoadError title="Não foi possível carregar os cards" onRetry={reload} />
      )}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState title="Nenhum card cadastrado" description="Crie o primeiro card." />
        ) : (
          <ul className="flex flex-col border-t border-border">
            {state.data.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4"
              >
                <div className="flex min-w-0 max-w-reading flex-col gap-1">
                  <span className="type-label">
                    {category.title}
                    {!category.active && ' (inativo)'}
                  </span>
                  <span className="type-small text-fg-muted">
                    {ACTION_LABEL[category.action]} · ordem {category.sortOrder} ·{' '}
                    <code>{category.key}</code>
                  </span>
                  {category.cardDescription && (
                    <span className="type-small">{category.cardDescription}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditing(category)}>
                    Editar
                  </Button>
                  <Button variant="ghost" onClick={() => setRemoving(category)}>
                    Apagar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {editing && (
        <CategoryDialog
          key={editing === 'new' ? 'new' : editing.id}
          category={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Apagar “${removing?.title ?? ''}”?`}
        description="O card some da tela inicial. Se só quer esconder, desative-o em vez de apagar."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => removing && void remove(removing)}>
              Apagar
            </Button>
          </>
        }
      />
    </AdminLayout>
  );
}
