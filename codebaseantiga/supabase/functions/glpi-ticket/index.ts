import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

interface TicketData {
  nome: string;
  email?: string;
  setor: string;
  ip?: string;
  ip_indisponivel?: boolean;
  on_behalf?: boolean;
  beneficiary?: {
    nome: string;
    matricula?: string;
    setor: string;
  };
  /** Histórico completo da conversa para resumo via IA */
  messages?: ChatMsg[];
  /** Fallback caso messages não venha */
  resumo_problema?: string;
  /** Categoria escolhida pelo usuário no card inicial (rótulo visível) */
  selected_category?: string | null;
  /** Metadados para analytics (não bloqueantes) */
  user_id?: string | null;
  agent_slug?: string | null;
  conversa_id?: string | null;
  /** Modo de teste: pula geração via IA e usa título/categoria fixos */
  test_mode?: boolean;
  /** URL pública (com token) da página de histórico completo da conversa */
  transcript_url?: string;
}

interface TicketSummary {
  titulo: string;
  /** Descrição narrativa detalhada do problema baseada na conversa (sem transcript bruto). */
  descricao: string;
  categoria: string;
  urgencia: 1 | 2 | 3 | 4 | 5;
}

const DEFAULT_GLPI_BASE = "https://suporte.pedroleopoldo.mg.gov.br";
const APP_PUBLIC_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://chicochat.pl.mg.gov.br").replace(/\/+$/, "");
const GLPI_API_VERSION = (Deno.env.get("GLPI_API_VERSION") ?? "v2.3").replace(/^\/+|\/+$/g, "");
const API_V2_PATH = `/api.php/${GLPI_API_VERSION}`;
const ASSISTANCE_PATH = "/api.php/Assistance";
const ADMIN_PATH = "/api.php/Administration";
const LEGACY_API_PATH = "/apirest.php";
const TOKEN_PATHS = Array.from(new Set([
  `${API_V2_PATH}/oauth/access_token`,
  `${API_V2_PATH}/token`,
  "/api.php/oauth/access_token",
  "/api.php/token",
  "/api.php/v2.1/oauth/access_token",
])) as readonly string[];
const DEFAULT_TIMEOUT_MS = 15000;
const AI_TIMEOUT_MS = 25000;
const IP_REGEX = /^(\d{2})\.(\d)\.(\d)\.(\d{2,3})$/;

function isValidAllowedIp(ip: string): boolean {
  if (!IP_REGEX.test(ip)) return false;
  return ip
    .split(".")
    .map(Number)
    .every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

/**
 * Normaliza a base URL do GLPI removendo trailing slashes E qualquer sufixo de API
 * (/apirest.php, /api.php/..., /api.php) que o usuário possa ter incluído no secret GLPI_URL.
 */
function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  if (normalized.startsWith("http://suporte.pedroleopoldo.mg.gov.br")) {
    normalized = normalized.replace("http://", "https://");
  }
  normalized = normalized.replace(/\/+$/, "");
  // Remove sufixos comuns de API para deixar apenas a origem
  normalized = normalized.replace(/\/api\.php(\/v\d+(\.\d+)*)?$/, "");
  normalized = normalized.replace(/\/apirest\.php$/, "");
  return normalized.replace(/\/+$/, "");
}

function truncate(text: string, maxLength = 120): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/* ============================================================
 * Geração de resumo + título via Lovable AI (Gemini Flash)
 * ============================================================ */

// Lista oficial de categorias (alinhada aos cards exibidos no chat).
// Usada tanto no enum do Gemini quanto na validação da categoria pré-selecionada.
const CARD_CATEGORIES = [
  "Computador e Equipamentos",
  "Rede e internet",
  "E-mail e comunicação",
  "Segurança da informação",
  "Instalação de Programas",
  "Sistemas GRP Sonner",
  "Dúvidas referentes ao SEI",
  "Manutenção de Impressora",
  "Acessos e Senhas",
  "Outra coisa?",
  "Suporte técnico geral",
] as const;

const DEFAULT_CATEGORY = "Suporte técnico geral";

/**
 * Valida a categoria recebida do cliente.
 * - null/undefined/""  -> retorna null (sem categoria pré-selecionada, IA decide)
 * - string válida      -> retorna a string normalizada
 * - string inválida    -> registra warning e retorna DEFAULT_CATEGORY
 */
function validateSelectedCategory(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    console.warn(
      "[glpi-ticket] selected_category inválida (tipo não-string):",
      typeof raw,
      "-> usando",
      DEFAULT_CATEGORY,
    );
    return DEFAULT_CATEGORY;
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 100) {
    console.warn(
      "[glpi-ticket] selected_category inválida (excede 100 chars):",
      trimmed.slice(0, 50),
      "-> usando",
      DEFAULT_CATEGORY,
    );
    return DEFAULT_CATEGORY;
  }
  if ((CARD_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  console.warn(
    "[glpi-ticket] selected_category fora da lista permitida:",
    JSON.stringify(trimmed),
    "-> usando",
    DEFAULT_CATEGORY,
  );
  return DEFAULT_CATEGORY;
}

/** Extrai uma fala curta e representativa do usuário como fallback do problema. */
function extractFirstUserMessage(messages: ChatMsg[]): string {
  const userMessages = (messages ?? []).filter((m) => m.role === "user" && m.content?.trim());
  const specific = userMessages
    .filter((m) => {
      const text = m.content.trim();
      return !/^(ol[aá]|oi|bom dia|boa tarde|boa noite|tudo bem)[!,.?\s]*$/i.test(text)
        && !/^ol[aá]! tenho uma demanda de ti que n[aã]o se encaixa nas op[cç][oõ]es listadas\./i.test(text);
    })
    .sort((a, b) => b.content.trim().length - a.content.trim().length)[0];
  return (specific ?? userMessages[0])?.content?.trim() || "";
}

const FALLBACK_MAX_CHARS = 2500;

function hasRequiredSummarySections(descricao: string): boolean {
  const sections = [
    "Problema identificado:",
    "Contexto:",
    "Comportamento observado:",
    "Tentativas já realizadas:",
    "Impacto operacional:",
    "Ação esperada:",
  ];
  let previousIndex = -1;
  for (const section of sections) {
    const index = descricao.indexOf(section, previousIndex + 1);
    if (index === -1) return false;
    previousIndex = index;
  }
  return true;
}

function normalizeSummarySectionHeadings(descricao: string): string {
  return descricao.replace(
    /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(Problema identificado|Contexto|Comportamento observado|Tentativas já realizadas|Impacto operacional|Ação esperada):\s*(?:\*\*|__)?\s*$/gim,
    "$1:",
  );
}

/** Fallback seguro — NUNCA inclui transcript bruto. */
function buildFallbackSummary(
  messages: ChatMsg[],
  fallbackResumo: string,
  setor: string,
  lockedCategory: string | null,
): TicketSummary {
  const baseResumo = fallbackResumo?.trim()
    ? fallbackResumo.trim().slice(0, FALLBACK_MAX_CHARS)
    : extractFirstUserMessage(messages).slice(0, FALLBACK_MAX_CHARS);
  const problema = baseResumo || "Os detalhes do problema não puderam ser consolidados automaticamente no momento da abertura.";
  return {
    titulo: `Solicitação de suporte — ${setor}`.slice(0, 80),
    descricao: `Problema identificado:
${problema}

Contexto:
Setor: ${setor}. Escopo não confirmado pelo usuário.

Comportamento observado:
Detalhes adicionais não puderam ser consolidados automaticamente no momento da abertura.

Tentativas já realizadas:
Não foi possível consolidar automaticamente as tentativas realizadas.

Impacto operacional:
Impacto não detalhado pelo usuário; assumir impacto sobre as atividades do setor informado.

Ação esperada:
Realizar diagnóstico técnico com base no problema informado e consultar a conversa completa vinculada ao chamado se forem necessários detalhes adicionais.`,
    categoria: lockedCategory ?? "Suporte técnico geral",
    urgencia: 3,
  };
}

async function summarizeConversation(
  messages: ChatMsg[],
  fallbackResumo: string,
  setor: string,
  selectedCategory?: string | null,
): Promise<TicketSummary> {
  const GEMINI_API_KEY = (Deno.env.get("GEMINI_API_KEY") || "").trim();

  const lockedCategory =
    selectedCategory && (CARD_CATEGORIES as readonly string[]).includes(selectedCategory) ? selectedCategory : null;

  if (!GEMINI_API_KEY || (!messages?.length && !fallbackResumo)) {
    console.warn("[summarize] sem GEMINI_API_KEY ou sem mensagens — usando fallback");
    return buildFallbackSummary(messages, fallbackResumo, setor, lockedCategory);
  }

  const transcript =
    messages && messages.length > 0
      ? messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => `${m.role === "user" ? "USUÁRIO" : "BOT"}: ${m.content}`)
          .join("\n\n")
      : fallbackResumo;

  const systemPrompt = `Você é um analista de suporte técnico (N2) que transforma uma conversa entre o usuário e o bot ChicoChat+ em um chamado pronto para ser tratado no GLPI.

OBJETIVO: o técnico que receber o chamado deve conseguir atuar SEM precisar ler a conversa original. Consolide, organize e tecnicize todas as informações.

REGRAS GERAIS (obrigatórias):
- NÃO copie mensagens literalmente da conversa. NÃO use prefixos "USUÁRIO:" / "BOT:".
- NÃO faça resumo genérico. NÃO use linguagem informal/saudações.
- Integre TODAS as informações dispersas (equipamento, sistema, sintomas, erros, momento de início, escopo, tentativas).
- Inclua TODAS as tentativas realizadas pelo usuário. Se nenhuma foi mencionada, escreva exatamente: "Nenhuma tentativa prévia informada.".
- NÃO invente fatos. Se algo não foi dito, não cite — exceto onde houver instrução explícita de preencher.
- Texto profissional, técnico, em português.

1. TÍTULO (campo "titulo")
- Resume claramente o problema; contém sintoma principal; cita sistema/equipamento/local quando possível; específico.
- Máximo 120 caracteres. Proibido título genérico tipo "Atendimento de TI", "Suporte solicitado", "Chamado aberto".
- Exemplos: "Sistema tributário trava ao emitir certidão", "Impressora do RH não envia documentos pela rede", "Usuário não consegue autenticar no sistema".

2. DESCRIÇÃO (campo "descricao") — FORMATO OBRIGATÓRIO, exatamente com estes rótulos e nesta ordem, separados por linha em branco:

Problema identificado:
[descrição técnica e específica do problema, 1-3 frases]

Contexto:
[setor, equipamento/sistema envolvido, quando começou, escopo — individual ou coletivo. Se a conversa não esclarecer escopo individual vs. departamental, registre "Escopo não confirmado pelo usuário."]

Comportamento observado:
[sintomas concretos, mensagens de erro, comportamento da máquina/sistema]

Tentativas já realizadas:
[lista em texto corrido ou bullets curtos com cada tentativa do usuário; se nenhuma, escrever literalmente: "Nenhuma tentativa prévia informada."]

Impacto operacional:
[como afeta o trabalho do usuário/setor; se não houver dado claro, escreva "Impacto não detalhado pelo usuário; assumir impacto sobre as atividades do setor informado."]

Ação esperada:
[o que o técnico precisa fazer para resolver — verificar X, restaurar Y, configurar Z, comparecer ao local, etc.]

3. CATEGORIA (campo "categoria")
- Escolha um dos valores permitidos. Use "Suporte técnico geral" só como último recurso.

4. URGÊNCIA (campo "urgencia")
- INTEIRO (number, sem aspas), 1-5. Padrão 3. Use 4-5 apenas se afetar múltiplos usuários ou serviço crítico.

VALIDAÇÃO FINAL antes de responder:
- O técnico consegue atuar sem ler o chat? As tentativas estão incluídas? O impacto está claro? O texto é profissional? O título é específico?

SEMPRE responda chamando a função registrar_chamado_glpi com TODOS os campos preenchidos.`;

  const userPrompt = `Setor do usuário: ${setor}

Transcrição da conversa (use APENAS para extrair os fatos — NÃO copie trechos, reescreva tudo como narrativa):
${transcript}`;

  const jsonInstruction = `\n\nRESPONDA APENAS com um objeto JSON válido (sem markdown, sem comentários) com EXATAMENTE estas chaves:\n{\n  "titulo": string (máx 120 chars),\n  "descricao": string contendo todas as 6 seções obrigatórias na ordem (Problema identificado / Contexto / Comportamento observado / Tentativas já realizadas / Impacto operacional / Ação esperada),\n  "categoria": uma das opções: ${CARD_CATEGORIES.map((c) => `"${c}"`).join(", ")},\n  "urgencia": número inteiro de 1 a 5\n}`;

  const CHICO_MODEL = "gemini-3.1-flash-lite";
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, (attempt - 1) * 800));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const resp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GEMINI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: CHICO_MODEL,
            temperature: 0.2,
            top_p: 0.9,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt + jsonInstruction },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: controller.signal,
        },
      );

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error("[summarize] Gemini status", resp.status, errText.slice(0, 500), {
          model: CHICO_MODEL,
          attempt,
          duration_ms: Date.now() - t0,
        });
        continue;
      }

      const data = await resp.json();
      console.log("[summarize] model_response", {
        model: CHICO_MODEL,
        attempt,
        duration_ms: Date.now() - t0,
        finish_reason: data?.choices?.[0]?.finish_reason ?? null,
        prompt_tokens: data?.usage?.prompt_tokens ?? null,
        completion_tokens: data?.usage?.completion_tokens ?? null,
        total_tokens: data?.usage?.total_tokens ?? null,
      });
      const content = data?.choices?.[0]?.message?.content;
      if (data?.choices?.[0]?.finish_reason === "length") {
        console.error("[summarize] resposta cortada pelo limite de tokens do modelo", { attempt });
      }
      if (!content || typeof content !== "string") {
        console.error("[summarize] resposta sem content:", JSON.stringify(data).slice(0, 600), { attempt });
        continue;
      }

      let parsed: any;
      try {
        // Remove blocos <think>...</think> (reasoning do Qwen) e fences ```json ... ```
        const cleaned = content
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .replace(/^\s*```(?:json)?\s*/i, "")
          .replace(/\s*```\s*$/i, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error("[summarize] JSON.parse falhou:", e, "attempt:", attempt, "raw:", content.slice(0, 400));
        continue;
      }

      const aiCategoria = String(parsed.categoria || "Suporte técnico geral");
      const descricaoAi = normalizeSummarySectionHeadings(String(parsed.descricao || "").trim());
      if (!descricaoAi) {
        console.error("[summarize] descrição vazia na resposta da IA", { attempt });
        continue;
      }
      if (!hasRequiredSummarySections(descricaoAi)) {
        console.warn("[summarize] descrição sem todas as seções obrigatórias na ordem esperada", { attempt });
        continue;
      }
      const urgenciaNum = Number.parseInt(String(parsed.urgencia ?? "3"), 10);
      const urgenciaSafe = ([1, 2, 3, 4, 5] as const).includes(urgenciaNum as any)
        ? (urgenciaNum as 1 | 2 | 3 | 4 | 5)
        : 3;
      const result: TicketSummary = {
        titulo: truncate(String(parsed.titulo || "").trim() || `Solicitação de suporte — ${setor}`, 120),
        descricao: descricaoAi,
        categoria: lockedCategory ?? aiCategoria,
        urgencia: urgenciaSafe,
      };
      console.log("[summarize] OK:", {
        attempt,
        titulo: result.titulo,
        categoria: result.categoria,
        descLen: result.descricao.length,
      });
      return result;
    } catch (e) {
      console.error("[summarize] exceção (attempt " + attempt + "):", e);
    } finally {
      clearTimeout(timeout);
    }

  }

  console.warn("[summarize] todas as tentativas falharam — usando fallback");
  return buildFallbackSummary(messages, fallbackResumo, setor, lockedCategory);
}

function buildDescription(ticket: TicketData, summary: TicketSummary, _requesterFound: boolean): string {
  const solicitante = ticket.email ? `${ticket.nome} (${ticket.email})` : ticket.nome;

  let beneficiaryBlock = "";
  if (ticket.on_behalf && ticket.beneficiary?.nome?.trim()) {
    const b = ticket.beneficiary;
    const matriculaLine = b.matricula?.trim() ? `\n**Matrícula:** ${b.matricula.trim()}` : "";
    beneficiaryBlock = `

### Atendimento solicitado para terceiro
**Nome do atendido:** ${b.nome.trim()}${matriculaLine}
**Unidade/Setor:** ${b.setor.trim()}`;
  }

  const transcriptBlock = ticket.transcript_url
    ? `

---

**Visualizar conversa completa:** ${ticket.transcript_url}`
    : "";


  return `**Chamado aberto automaticamente pelo ChicoChat+**

**Solicitante:** ${solicitante}
**Setor do solicitante:** ${ticket.setor}
**IP da máquina:** ${ticket.ip_indisponivel ? "Não informado — usuário sem acesso à máquina" : ticket.ip}
**Categoria:** ${summary.categoria}${beneficiaryBlock}

---

${summary.descricao}${transcriptBlock}`;
}

/* ============================================================
 * GLPI High-Level API v2.1 — Autenticação OAuth2 (Password Grant)
 * ============================================================ */

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedLegacySession: { token: string; expiresAt: number } | null = null;
const TOKEN_SAFETY_WINDOW_MS = 60_000;
const AUTH_TIMEOUT_MS = 15000;

interface OAuthTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
}

type OAuthFailureKind = "timeout" | "auth" | "endpoint" | "http" | "response" | "network";

class OAuthAttemptError extends Error {
  kind: OAuthFailureKind;
  url: string;
  status?: number;

  constructor(kind: OAuthFailureKind, url: string, message: string, status?: number) {
    super(message);
    this.name = "OAuthAttemptError";
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

async function fetchOAuthToken(
  baseUrl: string,
  path: string,
  clientId: string,
  clientSecret: string,
  username: string,
  password: string,
  useBasicAuth = false,
): Promise<{ token: string; expiresIn: number }> {
  const url = `${baseUrl}${path}`;
  console.log(`[oauth] solicitando token em ${url}${useBasicAuth ? " (basic)" : ""}`);

  const params: Record<string, string> = {
    grant_type: "password",
    username,
    password,
    scope: "api user",
  };
  if (!useBasicAuth) {
    params.client_id = clientId;
    params.client_secret = clientSecret;
  }
  const body = new URLSearchParams(params);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...(useBasicAuth
          ? { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` }
          : {}),
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const text = await resp.text();
    const elapsed = Date.now() - startedAt;

    if (!resp.ok) {
      console.error(`[oauth] token request failed (${elapsed}ms):`, resp.status, text.slice(0, 300));
      if (resp.status === 401 || resp.status === 400) {
        throw new OAuthAttemptError(
          "auth",
          url,
          "Credenciais OAuth do GLPI inválidas (client_id/secret ou usuário/senha).",
          resp.status,
        );
      }
      if (resp.status === 404 || resp.status === 405) {
        throw new OAuthAttemptError(
          "endpoint",
          url,
          `Endpoint OAuth não disponível no GLPI (status ${resp.status}).`,
          resp.status,
        );
      }
      throw new OAuthAttemptError("http", url, `Falha ao autenticar no GLPI (status ${resp.status}).`, resp.status);
    }

    let data: OAuthTokenResponse;
    try {
      data = JSON.parse(text);
    } catch {
      throw new OAuthAttemptError("response", url, "Resposta inválida do endpoint de token OAuth do GLPI.");
    }

    if (!data.access_token) {
      throw new OAuthAttemptError("response", url, "access_token ausente na resposta do GLPI.");
    }

    console.log(`[oauth] token obtido (${elapsed}ms, expira em ${data.expires_in}s)`);
    return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
  } catch (error) {
    if (error instanceof OAuthAttemptError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OAuthAttemptError("timeout", url, "Tempo limite ao solicitar token OAuth do GLPI.");
    }
    throw new OAuthAttemptError(
      "network",
      url,
      error instanceof Error ? error.message : "Falha de rede ao solicitar token OAuth do GLPI.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildOAuthFailureMessage(errors: OAuthAttemptError[]): string {
  const authError = errors.find((e) => e.kind === "auth");
  if (authError) return authError.message;

  const responsiveError = errors.find((e) => e.kind === "http" || e.kind === "response");
  if (responsiveError) return responsiveError.message;

  const allBlocked = errors.length > 0 && errors.every((e) => e.kind === "timeout" || e.kind === "network");
  if (allBlocked) {
    return "O GLPI não respondeu ao solicitar token OAuth. Conexão com o portal indisponível ou bloqueada para todos os endpoints OAuth conhecidos.";
  }

  return "Não foi possível autenticar no GLPI pelos endpoints OAuth disponíveis.";
}

async function getAccessToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  username: string,
  password: string,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS) {
    return cachedToken.token;
  }

  try {
    const attempts = TOKEN_PATHS.flatMap((path) => [
      fetchOAuthToken(baseUrl, path, clientId, clientSecret, username, password, false),
      fetchOAuthToken(baseUrl, path, clientId, clientSecret, username, password, true),
    ]);
    const { token, expiresIn } = await Promise.any(attempts);
    attempts.forEach((attempt) => attempt.catch(() => undefined));
    cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  } catch (error) {
    cachedToken = null;
    if (error instanceof AggregateError) {
      const errors = error.errors.filter((e): e is OAuthAttemptError => e instanceof OAuthAttemptError);
      console.error(
        "[oauth] todos os endpoints falharam:",
        errors.map((e) => ({ url: e.url, kind: e.kind, status: e.status })),
      );
      throw new Error(buildOAuthFailureMessage(errors));
    }
    throw error;
  }
}

/* ============================================================
 * GLPI: chamadas autenticadas
 * ============================================================ */

async function glpiGet(url: string, accessToken: string): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
  } catch (e) {
    console.warn("[glpiGet] error:", e);
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Busca o ID do usuário no GLPI a partir do e-mail institucional (API v2.1).
 * Usa o filtro RSQL da nova API — muito mais simples que a legacy.
 */
async function findGlpiUserByEmail(baseUrl: string, accessToken: string, email: string): Promise<number | null> {
  if (!email) return null;
  const emailNorm = email.trim().toLowerCase();

  const extractUserId = (rows: any[]): number | null => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    for (const row of rows) {
      const v = Number(row?.id);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  };

  const attempts: { path: string; filter: string }[] = [
    { path: `${ADMIN_PATH}/User`, filter: `emails.email==${emailNorm}` },
    { path: `${ADMIN_PATH}/User`, filter: `emails.email=ilike=${emailNorm}` },
    { path: `${ADMIN_PATH}/User`, filter: `email==${emailNorm}` },
    { path: `${API_V2_PATH}/User`, filter: `emails.email==${emailNorm}` },
    { path: `${API_V2_PATH}/User`, filter: `emails.email=ilike=${emailNorm}` },
  ];

  for (const a of attempts) {
    const url = `${baseUrl}${a.path}?` + new URLSearchParams({ filter: a.filter, limit: "5" });
    const r = await glpiGet(url, accessToken);
    console.log("[glpi-ticket] User lookup:", { path: a.path, filter: a.filter, status: r.status, ok: r.ok });
    if (r.ok) {
      const rows = Array.isArray(r.data) ? r.data : (r.data?.items ?? r.data?.data ?? []);
      const userId = extractUserId(rows);
      if (userId) {
        console.log("[glpi-ticket] requester resolved:", { email: emailNorm, userId, via: a });
        return userId;
      }
    }
  }

  console.log("[glpi-ticket] requester NOT found for email:", emailNorm);
  return null;
}

async function createTicket(
  baseUrl: string,
  accessToken: string,
  ticket: TicketData,
  summary: TicketSummary,
  requesterUserId: number | null,
): Promise<{ ticketId: string | number; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const title = truncate(summary.titulo, 80);
  const description = buildDescription(ticket, summary, requesterUserId !== null);

  // Payload compatível com a High-Level API v2.1 (schema Ticket)
  const payload: Record<string, unknown> = {
    name: title,
    content: description,
    type: 1, // 1 = Incident, 2 = Request
    request_type: { id: 10 }, // 10 = Helpdesk (Chatbot)
    urgency: summary.urgencia,
    impact: summary.urgencia,
    priority: summary.urgencia,
  };

  try {
    const url = `${baseUrl}${ASSISTANCE_PATH}/Ticket`;
    console.log(`[glpi] POST ${url}`);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "GLPI-Entity-Recursive": "true",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (resp.status !== 200 && resp.status !== 201) {
      const errBody = await resp.text();
      console.error("GLPI create ticket failed:", resp.status, errBody.slice(0, 500));
      if (resp.status === 401 || resp.status === 403) {
        cachedToken = null;
        throw new Error(
          "Token OAuth inválido ou sem permissão para criar chamado. Verifique se o cliente OAuth tem o scope 'api' e se o usuário de serviço tem perfil com permissão de abrir chamados.",
        );
      }
      if (resp.status === 404) {
        throw new Error(
          "O GLPI respondeu 404 ao criar o chamado. Isso normalmente indica que o usuário de serviço (GLPI_USERNAME) não tem entidade padrão definida ou não possui perfil com acesso à API de Chamados. Verifique em: Administração → Usuários → [seu usuário] → Habilitações.",
        );
      }
      throw new Error(`GLPI retornou status ${resp.status}.`);
    }

    const data = await resp.json().catch(() => ({}));
    const ticketId = data?.id ?? data?.ID ?? data?.ticket_id;
    if (!ticketId) {
      throw new Error("Resposta inesperada do GLPI: ID do chamado não encontrado.");
    }

    // Adiciona o requester (usuário solicitante) via TeamMember após criação
    if (requesterUserId !== null) {
      try {
        const tmUrl = `${baseUrl}${ASSISTANCE_PATH}/Ticket/${ticketId}/TeamMember`;
        const tmResp = await fetch(tmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ type: "User", id: requesterUserId, role: "requester" }),
        });
        if (!tmResp.ok) {
          console.warn("[glpi] falha ao anexar requester:", tmResp.status, (await tmResp.text()).slice(0, 200));
        }
      } catch (e) {
        console.warn("[glpi] erro ao anexar requester:", e);
      }
    }

    return { ticketId, status: resp.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Tempo limite ao conectar com o GLPI.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/* ============================================================
 * GLPI Legacy API — fallback quando a High-Level API v2.x falhar
 * ============================================================ */

function legacyHeaders(appToken?: string, sessionToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (appToken) headers["App-Token"] = appToken;
  if (sessionToken) headers["Session-Token"] = sessionToken;
  return headers;
}

async function getLegacySessionToken(
  baseUrl: string,
  appToken: string | undefined,
  userToken: string,
): Promise<string> {
  if (cachedLegacySession && cachedLegacySession.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS) {
    return cachedLegacySession.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const url = `${baseUrl}${LEGACY_API_PATH}/initSession`;
  console.log(`[legacy] iniciando sessão em ${url}`);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        ...legacyHeaders(appToken),
        Authorization: `user_token ${userToken}`,
      },
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error("[legacy] initSession failed:", resp.status, text.slice(0, 300));
      throw new Error(`Falha na API legada do GLPI (status ${resp.status}).`);
    }
    const data = JSON.parse(text);
    if (!data?.session_token) throw new Error("session_token ausente na resposta da API legada do GLPI.");
    cachedLegacySession = { token: data.session_token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return data.session_token;
  } catch (error) {
    cachedLegacySession = null;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("O GLPI também não respondeu pela API legada. Conexão com o portal indisponível ou bloqueada.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createTicketLegacy(
  baseUrl: string,
  appToken: string | undefined,
  userToken: string,
  ticket: TicketData,
  summary: TicketSummary,
): Promise<{ ticketId: string | number; status: number }> {
  const sessionToken = await getLegacySessionToken(baseUrl, appToken, userToken);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const title = truncate(summary.titulo, 80);
  const description = buildDescription(ticket, summary, false);
  const payload = {
    input: {
      name: title,
      content: description,
      requesttypes_id: 10,
      urgency: summary.urgencia,
      impact: summary.urgencia,
      priority: summary.urgencia,
    },
  };

  try {
    const resp = await fetch(`${baseUrl}${LEGACY_API_PATH}/Ticket`, {
      method: "POST",
      headers: legacyHeaders(appToken, sessionToken),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await resp.text();

    if (resp.status !== 200 && resp.status !== 201) {
      console.error("[legacy] create ticket failed:", resp.status, text.slice(0, 500));
      if (resp.status === 401 || resp.status === 403) {
        cachedLegacySession = null;
        throw new Error("Token legado do GLPI inválido ou sem permissão para criar chamado.");
      }
      throw new Error(`API legada do GLPI retornou status ${resp.status}.`);
    }

    const data = JSON.parse(text || "{}");
    const ticketId = data?.id ?? data?.ID ?? data?.ticket_id;
    if (!ticketId) throw new Error("Resposta inesperada da API legada do GLPI: ID do chamado não encontrado.");
    return { ticketId, status: resp.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Tempo limite ao conectar com o GLPI pela API legada.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/* ============================================================
 * Handler
 * ============================================================ */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GLPI_BASE_URL = normalizeBaseUrl(Deno.env.get("GLPI_URL") || DEFAULT_GLPI_BASE);
    const GLPI_CLIENT_ID = Deno.env.get("GLPI_CLIENT_ID");
    const GLPI_CLIENT_SECRET = Deno.env.get("GLPI_CLIENT_SECRET");
    const GLPI_USERNAME = Deno.env.get("GLPI_USERNAME");
    const GLPI_PASSWORD = Deno.env.get("GLPI_PASSWORD");
    const GLPI_APP_TOKEN = Deno.env.get("GLPI_APP_TOKEN") || Deno.env.get("GLPI_API_TOKEN") || undefined;
    const GLPI_USER_TOKEN = Deno.env.get("GLPI_USER_TOKEN") || undefined;

    const hasOAuthCredentials = !!GLPI_CLIENT_ID && !!GLPI_CLIENT_SECRET && !!GLPI_USERNAME && !!GLPI_PASSWORD;
    const hasLegacyCredentials = !!GLPI_USER_TOKEN;

    if (!hasOAuthCredentials && !hasLegacyCredentials) {
      console.error("Missing GLPI credentials", {
        hasClientId: !!GLPI_CLIENT_ID,
        hasClientSecret: !!GLPI_CLIENT_SECRET,
        hasUsername: !!GLPI_USERNAME,
        hasPassword: !!GLPI_PASSWORD,
        hasAppToken: !!GLPI_APP_TOKEN,
        hasUserToken: !!GLPI_USER_TOKEN,
      });
      return new Response(JSON.stringify({ error: "Credenciais do GLPI não configuradas no backend." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ticketData: TicketData = await req.json();
    if (!ticketData.nome?.trim() || !ticketData.setor?.trim()) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios: nome e setor." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ipValue = ticketData.ip?.trim();
    const ipUnavailable = ticketData.ip_indisponivel === true;
    if (!ipUnavailable && (!ipValue || !isValidAllowedIp(ipValue))) {
      return new Response(JSON.stringify({ error: "IP inválido. Use o formato XX.X.X.XX ou XX.X.X.XXX." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanTicket: TicketData = {
      nome: ticketData.nome.trim(),
      email: ticketData.email?.trim() || undefined,
      setor: ticketData.setor.trim(),
      ip: ipUnavailable ? undefined : ipValue,
      ip_indisponivel: ipUnavailable,
      on_behalf: ticketData.on_behalf === true,
      beneficiary:
        ticketData.on_behalf === true && ticketData.beneficiary?.nome?.trim() && ticketData.beneficiary?.setor?.trim()
          ? {
              nome: ticketData.beneficiary.nome.trim(),
              matricula: ticketData.beneficiary.matricula?.trim() || undefined,
              setor: ticketData.beneficiary.setor.trim(),
            }
          : undefined,
      messages: ticketData.messages,
      resumo_problema: ticketData.resumo_problema?.trim(),
      selected_category: validateSelectedCategory(ticketData.selected_category),
      user_id: ticketData.user_id ?? null,
      agent_slug: ticketData.agent_slug ?? null,
      conversa_id: ticketData.conversa_id ?? null,
      test_mode: ticketData.test_mode === true,
    };

    // Token do histórico completo da conversa (link exclusivo incluído no chamado)
    const transcriptToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const hasTranscript = (cleanTicket.messages?.length ?? 0) > 0 && !cleanTicket.test_mode;
    if (hasTranscript) {
      cleanTicket.transcript_url = `${APP_PUBLIC_URL}/conversa/${transcriptToken}`;
    }

    // Supabase admin client (service role) for analytics writes — never blocks ticket flow
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    async function recordTicket(record: Record<string, unknown>) {
      try {
        const { error } = await supabaseAdmin.from("tickets").insert(record);
        if (error) console.error("Failed to record ticket analytics:", error);
      } catch (e) {
        console.error("recordTicket exception:", e);
      }
    }

    let summary: TicketSummary | null = null;
    try {
      if (cleanTicket.test_mode) {
        // Modo de teste: pula IA e usa título/descrição fixos
        const dataStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        summary = {
          titulo: "Chamado de teste",
          descricao: `Este é um chamado de teste aberto pelo ChicoChat+ em ${dataStr} pelo setor ${cleanTicket.setor}.\n\nNenhuma ação é necessária — o chamado pode ser fechado.`,
          categoria: "Teste",
          urgencia: 1,
        };
        console.log("[glpi-ticket] Modo de teste ativado — pulando IA.");
      } else {
        // 1. Gera resumo estruturado via IA
        summary = await summarizeConversation(
          cleanTicket.messages || [],
          cleanTicket.resumo_problema || "",
          cleanTicket.setor,
          cleanTicket.selected_category,
        );
        console.log("Ticket summary generated:", {
          titulo: summary.titulo,
          categoria: summary.categoria,
          urgencia: summary.urgencia,
        });
      }

      let requesterUserId: number | null = null;
      let result: { ticketId: string | number; status: number };

      try {
        if (!hasOAuthCredentials) throw new Error("OAuth GLPI não configurado; usando fallback legado.");

        // 2. Autentica no GLPI via OAuth2 (password grant)
        const accessToken = await getAccessToken(
          GLPI_BASE_URL,
          GLPI_CLIENT_ID!,
          GLPI_CLIENT_SECRET!,
          GLPI_USERNAME!,
          GLPI_PASSWORD!,
        );

        // 3. Busca o requerente no GLPI por e-mail (não bloqueante)
        requesterUserId = cleanTicket.email
          ? await findGlpiUserByEmail(GLPI_BASE_URL, accessToken, cleanTicket.email)
          : null;

        // 4. Cria ticket pela High-Level API
        result = await createTicket(GLPI_BASE_URL, accessToken, cleanTicket, summary, requesterUserId);
      } catch (oauthError) {
        cachedToken = null;
        // A API legada (/apirest.php) foi desativada neste GLPI ("API desativada"),
        // então não tentamos fallback — propagamos o erro real da High-Level API.
        console.error(
          "[glpi-ticket] falha na High-Level API v2.1:",
          oauthError instanceof Error ? oauthError.message : oauthError,
        );
        throw oauthError;
      }

      console.log("GLPI ticket created:", { id: result.ticketId, requesterUserId });

      // 4b. Salva o histórico completo da conversa acessível pelo link do chamado
      if (hasTranscript) {
        try {
          const { error: trError } = await supabaseAdmin.from("ticket_transcripts").insert({
            token: transcriptToken,
            conversa_id: cleanTicket.conversa_id,
            user_id: cleanTicket.user_id,
            glpi_ticket_id: String(result.ticketId),
            nome: cleanTicket.nome,
            email: cleanTicket.email ?? null,
            setor: cleanTicket.setor,
            titulo: summary.titulo,
            resumo: summary.descricao,
            messages: (cleanTicket.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
          });
          if (trError) console.error("[glpi-ticket] falha ao salvar transcript:", trError);
          else console.log("[glpi-ticket] transcript salvo:", cleanTicket.transcript_url);
        } catch (e) {
          console.error("[glpi-ticket] exceção ao salvar transcript:", e);
        }
      }



      // 5. Registra ticket de sucesso para analytics
      await recordTicket({
        user_id: cleanTicket.user_id,
        agent_slug: cleanTicket.agent_slug,
        conversa_id: cleanTicket.conversa_id,
        glpi_ticket_id: String(result.ticketId),
        status: "success",
        nome: cleanTicket.nome,
        email: cleanTicket.email ?? null,
        setor: cleanTicket.setor,
        ip: cleanTicket.ip ?? null,
        titulo: summary.titulo,
        categoria: summary.categoria,
        motivo: summary.descricao,
      });

      return new Response(
        JSON.stringify({
          success: true,
          ticket_id: result.ticketId,
          message: "Chamado aberto com sucesso!",
          glpi_url: GLPI_BASE_URL,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      console.error("glpi-ticket error:", e);
      const knownMessage = e instanceof Error ? e.message : "";
      const feedback = knownMessage || "Erro ao abrir chamado. Tente novamente.";

      // Registra falha para analytics
      await recordTicket({
        user_id: cleanTicket.user_id,
        agent_slug: cleanTicket.agent_slug,
        conversa_id: cleanTicket.conversa_id,
        glpi_ticket_id: null,
        status: "failed",
        nome: cleanTicket.nome,
        email: cleanTicket.email ?? null,
        setor: cleanTicket.setor,
        ip: cleanTicket.ip ?? null,
        titulo: summary?.titulo ?? null,
        categoria: summary?.categoria ?? null,
        motivo: summary?.descricao ?? cleanTicket.resumo_problema ?? null,
        error_message: feedback,
      });

      return new Response(JSON.stringify({ error: feedback }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("glpi-ticket outer error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro inesperado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
