import {
  adminCategoriesResponseSchema,
  adminCategorySchema,
  adminConversationDetailSchema,
  adminConversationListSchema,
  adminUsersResponseSchema,
  auditResponseSchema,
  effectivePromptSchema,
  insightsResponseSchema,
  instructionVersionSchema,
  instructionsStateSchema,
  metricsResponseSchema,
  type AdminCategory,
  type AdminConversationDetail,
  type AdminConversationList,
  type AdminPeriod,
  type AdminUsersResponse,
  type AuditResponse,
  type CreateCategoryRequest,
  type EffectivePrompt,
  type ExportType,
  type InsightsResponse,
  type InstructionVersion,
  type InstructionsState,
  type MetricsResponse,
  type RehearsalEvent,
  type UpdateCategoryRequest,
  type UserRole,
} from '@chicochat/shared';
import { call } from './api';

/**
 * Falha de uma chamada do painel. As mensagens do servidor para o administrador já vêm em
 * português e sem detalhe técnico (ex.: "Não é possível remover o último administrador"), então
 * a tela pode mostrá-las. Sem mensagem, a tela usa o texto dela.
 */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string | null) {
    super(message ?? `A API respondeu com o status ${status}`);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

async function failure(response: Response): Promise<AdminApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new AdminApiError(
      response.status,
      body.error?.code ?? null,
      // Erro de validação (422) fala de campos, não de texto para a pessoa.
      response.status === 422 ? null : (body.error?.message ?? null),
    );
  } catch {
    return new AdminApiError(response.status, null, null);
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await call(path, init);
  if (!response.ok) throw await failure(response);
  return response;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export async function fetchMetrics(period: AdminPeriod): Promise<MetricsResponse> {
  const response = await request(`/api/admin/metrics${query({ period })}`);
  return metricsResponseSchema.parse(await response.json());
}

export async function runInsights(period: AdminPeriod): Promise<InsightsResponse> {
  const response = await request('/api/admin/insights', { method: 'POST', ...json({ period }) });
  return insightsResponseSchema.parse(await response.json());
}

/** Endereço do CSV: o navegador baixa direto, com o cookie da sessão. */
export function exportUrl(type: ExportType, period: AdminPeriod): string {
  return `/api/admin/export/${type}${query({ period })}`;
}

export async function fetchAdminConversations(
  q: string,
  page: number,
): Promise<AdminConversationList> {
  const response = await request(`/api/admin/conversations${query({ q, page })}`);
  return adminConversationListSchema.parse(await response.json());
}

export async function fetchAdminConversation(id: string): Promise<AdminConversationDetail> {
  const response = await request(`/api/admin/conversations/${encodeURIComponent(id)}`);
  return adminConversationDetailSchema.parse(await response.json());
}

export async function fetchAdminCategories(): Promise<AdminCategory[]> {
  const response = await request('/api/admin/categories');
  return adminCategoriesResponseSchema.parse(await response.json()).categories;
}

export async function createAdminCategory(input: CreateCategoryRequest): Promise<AdminCategory> {
  const response = await request('/api/admin/categories', { method: 'POST', ...json(input) });
  return adminCategorySchema.parse(await response.json());
}

export async function updateAdminCategory(
  id: string,
  input: UpdateCategoryRequest,
): Promise<AdminCategory> {
  const response = await request(`/api/admin/categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    ...json(input),
  });
  return adminCategorySchema.parse(await response.json());
}

export async function deleteAdminCategory(id: string): Promise<void> {
  await request(`/api/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchInstructions(): Promise<InstructionsState> {
  const response = await request('/api/admin/instructions');
  return instructionsStateSchema.parse(await response.json());
}

export async function fetchInstructionVersion(version: number): Promise<InstructionVersion> {
  const response = await request(`/api/admin/instructions/versions/${version}`);
  return instructionVersionSchema.parse(await response.json());
}

export async function proposeInstructions(requestText: string): Promise<InstructionVersion> {
  const response = await request('/api/admin/instructions/propose', {
    method: 'POST',
    ...json({ request: requestText }),
  });
  return instructionVersionSchema.parse(await response.json());
}

export async function saveInstructionsDraft(content: string): Promise<InstructionVersion> {
  const response = await request('/api/admin/instructions/draft', {
    method: 'PUT',
    ...json({ content }),
  });
  return instructionVersionSchema.parse(await response.json());
}

export async function publishInstructions(version: number): Promise<void> {
  await request('/api/admin/instructions/draft/publish', { method: 'POST', ...json({ version }) });
}

export async function restoreInstructions(version: number): Promise<InstructionVersion> {
  const response = await request(`/api/admin/instructions/${version}/restore`, {
    method: 'POST',
  });
  return instructionVersionSchema.parse(await response.json());
}

export async function fetchEffectivePrompt(): Promise<EffectivePrompt> {
  const response = await request('/api/admin/prompt');
  return effectivePromptSchema.parse(await response.json());
}

export async function fetchAdminUsers(q: string, page: number): Promise<AdminUsersResponse> {
  const response = await request(`/api/admin/users${query({ q, page })}`);
  return adminUsersResponseSchema.parse(await response.json());
}

export async function changeUserRole(id: string, role: UserRole): Promise<void> {
  await request(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    ...json({ role }),
  });
}

export async function fetchAudit(action: string, page: number): Promise<AuditResponse> {
  const response = await request(`/api/admin/audit${query({ action, page })}`);
  return auditResponseSchema.parse(await response.json());
}

/**
 * Ensaio das instruções (SSE). Devolve os eventos já lidos; erro anterior ao primeiro trecho vira
 * `AdminApiError`.
 */
export async function* rehearse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal: AbortSignal,
): AsyncGenerator<RehearsalEvent, void, undefined> {
  const response = await request('/api/admin/instructions/draft/rehearse', {
    method: 'POST',
    signal,
    ...json({ messages }),
  });
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const raw = /^data: (.+)$/m.exec(block)?.[1];
        if (name && raw !== undefined) {
          try {
            yield { event: name, data: JSON.parse(raw) as never } as RehearsalEvent;
          } catch {
            // Bloco malformado: ignora.
          }
        }
        end = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
