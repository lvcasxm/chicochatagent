import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

async function getLocalChicoTicketIds(email: string): Promise<number[]> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return [];
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from("tickets")
      .select("glpi_ticket_id")
      .eq("status", "success")
      .ilike("email", email)
      .not("glpi_ticket_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.warn("[glpi-tickets] local tickets query failed:", error.message);
      return [];
    }
    const ids = (data ?? [])
      .map((r: any) => Number(r.glpi_ticket_id))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    console.log("[glpi-tickets] local ChicoChat ticket ids:", ids.length);
    return ids;
  } catch (e) {
    console.warn("[glpi-tickets] getLocalChicoTicketIds error:", e);
    return [];
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_GLPI_BASE = "https://suporte.pedroleopoldo.mg.gov.br";
const GLPI_API_VERSION = (Deno.env.get("GLPI_API_VERSION") ?? "v2.3").replace(/^\/+|\/+$/g, "");
const API_V2_PATH = `/api.php/${GLPI_API_VERSION}`;
const TOKEN_PATHS = Array.from(new Set([
  `${API_V2_PATH}/oauth/access_token`,
  `${API_V2_PATH}/token`,
  "/api.php/oauth/access_token",
  "/api.php/token",
  "/api.php/v2.1/oauth/access_token",
])) as readonly string[];
const DEFAULT_TIMEOUT_MS = 15000;
const AUTH_TIMEOUT_MS = 15000;

const ALLOWED_DOMAINS = ["@pedroleopoldo.mg.gov.br", "@pl.mg.gov.br"];

function normalizeBaseUrl(baseUrl: string): string {
  let n = baseUrl.trim();
  if (!n.startsWith("http")) n = `https://${n}`;
  if (n.startsWith("http://suporte.pedroleopoldo.mg.gov.br")) {
    n = n.replace("http://", "https://");
  }
  n = n.replace(/\/+$/, "");
  n = n.replace(/\/api\.php(\/v\d+(\.\d+)*)?$/, "");
  n = n.replace(/\/apirest\.php$/, "");
  return n.replace(/\/+$/, "");
}

/* ============================================================
 * OAuth2 (Password Grant) — cache de token
 * ============================================================ */

let cachedToken: { token: string; expiresAt: number } | null = null;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const startedAt = Date.now();

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
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });

    const text = await resp.text();
    const elapsed = Date.now() - startedAt;

    if (!resp.ok) {
      console.error(`[oauth] token request failed (${elapsed}ms):`, resp.status, text.slice(0, 300));
      if (resp.status === 400 || resp.status === 401) {
        throw new OAuthAttemptError("auth", url, "Credenciais OAuth do GLPI inválidas (client_id/secret ou usuário/senha).", resp.status);
      }
      if (resp.status === 404 || resp.status === 405) {
        throw new OAuthAttemptError("endpoint", url, `Endpoint OAuth não disponível no GLPI (status ${resp.status}).`, resp.status);
      }
      throw new OAuthAttemptError("http", url, `Falha OAuth GLPI (status ${resp.status}).`, resp.status);
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new OAuthAttemptError("response", url, "Resposta inválida do endpoint de token OAuth do GLPI.");
    }

    if (!data?.access_token) {
      throw new OAuthAttemptError("response", url, "access_token ausente.");
    }

    console.log(`[oauth] token obtido (${elapsed}ms, expira em ${data.expires_in}s)`);
    return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
  } catch (error) {
    if (error instanceof OAuthAttemptError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OAuthAttemptError("timeout", url, "Tempo limite ao solicitar token OAuth do GLPI.");
    }
    throw new OAuthAttemptError("network", url, error instanceof Error ? error.message : "Falha de rede ao solicitar token OAuth do GLPI.");
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
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  try {
    const attempts = TOKEN_PATHS.flatMap((path) => [
      fetchOAuthToken(baseUrl, path, clientId, clientSecret, username, password, false),
      fetchOAuthToken(baseUrl, path, clientId, clientSecret, username, password, true),
    ]);
    const data = await Promise.any(attempts);
    attempts.forEach((attempt) => attempt.catch(() => undefined));
    cachedToken = {
      token: data.token,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    return data.token;
  } catch (error) {
    cachedToken = null;
    if (error instanceof AggregateError) {
      const errors = error.errors.filter((e): e is OAuthAttemptError => e instanceof OAuthAttemptError);
      console.error("[oauth] todos os endpoints falharam:", errors.map((e) => ({ url: e.url, kind: e.kind, status: e.status })));
      throw new Error(buildOAuthFailureMessage(errors));
    }
    throw error;
  }
}

async function glpiGet(url: string, accessToken: string) {
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
  } finally {
    clearTimeout(timeout);
  }
}

async function findGlpiUserByEmail(
  baseUrl: string,
  accessToken: string,
  email: string,
): Promise<number | null> {
  const emailNorm = email.trim().toLowerCase();
  const ADMIN_PATH = "/api.php/Administration";

  const extractId = (rows: any[]): number | null => {
    if (!Array.isArray(rows)) return null;
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
    console.log("[glpi-tickets] User lookup:", { path: a.path, filter: a.filter, status: r.status, ok: r.ok });
    if (r.ok) {
      const rows = Array.isArray(r.data) ? r.data : (r.data?.items ?? r.data?.data ?? []);
      const id = extractId(rows);
      if (id) {
        console.log("[glpi-tickets] User resolved:", { email: emailNorm, userId: id, via: a });
        return id;
      }
    }
  }
  console.log("[glpi-tickets] User NOT found for:", emailNorm);
  return null;
}

function statusInfo(code: number): { label: string; emoji: string } {
  switch (code) {
    case 1: return { label: "Novo", emoji: "🟡" };
    case 2:
    case 3: return { label: "Em atendimento", emoji: "🔵" };
    case 4: return { label: "Pendente", emoji: "🟠" };
    case 5: return { label: "Solucionado", emoji: "🟢" };
    case 6: return { label: "Fechado", emoji: "⚫" };
    default: return { label: "Desconhecido", emoji: "⚪" };
  }
}

function urgencyLabel(code: number): string {
  switch (code) {
    case 1: return "Muito baixa";
    case 2: return "Baixa";
    case 3: return "Média";
    case 4: return "Alta";
    case 5: return "Muito alta";
    default: return "—";
  }
}

async function fetchTicketById(baseUrl: string, accessToken: string, id: number): Promise<any | null> {
  const url = `${baseUrl}/api.php/Assistance/Ticket/${id}`;
  const r = await glpiGet(url, accessToken);
  if (!r.ok) {
    console.warn("[glpi-tickets] fetchTicketById failed:", { id, status: r.status });
    return null;
  }
  return r.data;
}

async function listTicketsForUser(
  baseUrl: string,
  accessToken: string,
  userId: number,
  extraIds: number[] = [],
) {
  const collected = new Map<number, any>();

  // 1) Tickets whose recipient is this GLPI user (opened diretamente no portal)
  const url = `${baseUrl}/api.php/Assistance/Ticket?` + new URLSearchParams({
    filter: `user_recipient.id==${userId}`,
    sort: "date_mod:desc",
    limit: "50",
  });
  const r = await glpiGet(url, accessToken);
  console.log("[glpi-tickets] listTickets recipient:", { userId, status: r.status, ok: r.ok });
  if (r.ok) {
    const rows: any[] = Array.isArray(r.data) ? r.data : (r.data?.items ?? r.data?.data ?? []);
    for (const row of rows) {
      const id = Number(row.id);
      if (id) collected.set(id, row);
    }
  }

  // 2) Tickets abertos via ChicoChat (registrados na base local) — buscar individualmente
  const missing = extraIds.filter((id) => !collected.has(id));
  await Promise.all(missing.map(async (id) => {
    const row = await fetchTicketById(baseUrl, accessToken, id);
    if (row?.id) collected.set(Number(row.id), row);
  }));

  const rows = Array.from(collected.values()).sort((a, b) => {
    const da = String(a.date_mod ?? a.date ?? "");
    const db = String(b.date_mod ?? b.date ?? "");
    return db.localeCompare(da);
  });

  return rows.map((row: any) => ({
    id: Number(row.id) || null,
    titulo: String(row.name ?? ""),
    status: Number(row.status?.id ?? row.status) || 0,
    data_abertura: String(row.date ?? row.date_creation ?? ""),
    data_atualizacao: String(row.date_mod ?? ""),
    urgencia: Number(row.urgency ?? 0),
    descricao: String(row.content ?? ""),
  })).filter((t) => t.id);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.replace(" ", "T"));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

const DESC_MAX_CHARS = 4000;
const DESC_MIN_CHARS = 800;
const DESC_TOTAL_BUDGET = 30000;

function clipDescription(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
  const base = cut > max * 0.6 ? slice.slice(0, cut) : slice;
  return `${base.trimEnd()}\n\n_… descrição completa disponível no portal GLPI._`;
}

function renderTicketsMarkdown(tickets: any[]): string {
  let budget = DESC_TOTAL_BUDGET;
  const blocks = tickets.map((t) => {
    const s = statusInfo(t.status);
    const full = stripHtml(t.descricao || "");
    const limit = budget > 0 ? DESC_MAX_CHARS : DESC_MIN_CHARS;
    const desc = full ? clipDescription(full, limit) : "Sem descrição registrada.";
    budget -= Math.min(full.length, limit);
    return `---

### Chamado #${t.id} — ${t.titulo || "(sem título)"}
- **Status:** ${s.emoji} ${s.label}
- **Aberto em:** ${fmtDate(t.data_abertura)}
- **Última atualização:** ${fmtDate(t.data_atualizacao)}
- **Urgência:** ${urgencyLabel(t.urgencia)}

<details>
<summary>Ver detalhes</summary>

${desc}

[Abrir no portal GLPI](https://suporte.pedroleopoldo.mg.gov.br/front/ticket.form.php?id=${t.id})

</details>`;
  }).join("\n\n");

  return `📋 **Seus chamados no GLPI** (${tickets.length} encontrado${tickets.length === 1 ? "" : "s"}):

${blocks}

---

O que deseja fazer agora?
- Consultar novamente
- Abrir um novo chamado
- Voltar ao menu principal`;
}

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

    if (!GLPI_CLIENT_ID || !GLPI_CLIENT_SECRET || !GLPI_USERNAME || !GLPI_PASSWORD) {
      return new Response(
        JSON.stringify({ success: false, error: "Credenciais OAuth do GLPI não configuradas.", code: "NO_CREDS" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "E-mail obrigatório.", code: "NO_EMAIL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!ALLOWED_DOMAINS.some((d) => email.endsWith(d))) {
      return new Response(
        JSON.stringify({ success: false, error: "E-mail não institucional.", code: "INVALID_DOMAIN" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessToken = await getAccessToken(
      GLPI_BASE_URL,
      GLPI_CLIENT_ID,
      GLPI_CLIENT_SECRET,
      GLPI_USERNAME,
      GLPI_PASSWORD,
    );
    const userId = await findGlpiUserByEmail(GLPI_BASE_URL, accessToken, email);

    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "USER_NOT_FOUND",
          error: "Não localizei um cadastro vinculado ao seu e-mail institucional no GLPI.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const localIds = await getLocalChicoTicketIds(email);
    const tickets = await listTicketsForUser(GLPI_BASE_URL, accessToken, userId, localIds);
    const markdown = tickets.length > 0
      ? renderTicketsMarkdown(tickets)
      : "Você não possui chamados registrados no momento. Quer abrir um agora?";

    return new Response(
      JSON.stringify({
        success: true,
        tickets,
        count: tickets.length,
        markdown,
        user_id: userId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[glpi-tickets] error:", e);
    cachedToken = null;
    return new Response(
      JSON.stringify({
        success: false,
        code: "GLPI_UNAVAILABLE",
        error: e instanceof Error ? e.message : "Erro ao consultar GLPI.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
