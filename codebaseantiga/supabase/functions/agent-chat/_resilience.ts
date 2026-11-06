// Resiliência in-memory para agent-chat: semáforo, circuit breaker, retry+fallback.
// IMPORTANTE: cada instância da edge function tem seu próprio estado.
// Para escala horizontal real, migrar para Upstash Redis (Fase 5).

const MAX_CONCURRENT = 8;
const SLOT_WAIT_MS = 5000;
let inFlight = 0;
const waiters: Array<() => void> = [];

export async function acquireSlot(timeoutMs = SLOT_WAIT_MS): Promise<boolean> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return true;
  }
  return new Promise((resolve) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      inFlight++;
      resolve(true);
    };
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      const i = waiters.indexOf(release);
      if (i >= 0) waiters.splice(i, 1);
      resolve(false);
    }, timeoutMs);
    waiters.push(release);
  });
}

export function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

// Circuit breaker simples por janela deslizante.
const WINDOW = 20;
const FAIL_RATIO = 0.5;
const OPEN_MS = 30_000;
const recent: boolean[] = [];
let openUntil = 0;

export function circuitOpen(): boolean {
  return Date.now() < openUntil;
}

export function recordResult(ok: boolean) {
  recent.push(ok);
  if (recent.length > WINDOW) recent.shift();
  if (recent.length === WINDOW) {
    const fails = recent.filter((x) => !x).length;
    if (fails / WINDOW > FAIL_RATIO) {
      openUntil = Date.now() + OPEN_MS;
      recent.length = 0;
    }
  }
}

// Retry + timeout + fallback Google Gemini -> Lovable AI Gateway.
export type UpstreamResult = {
  resp: Response;
  mode: "normal" | "fallback";
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export async function callChatWithResilience(params: {
  body: Record<string, unknown>;
  geminiApiKey: string;
  lovableApiKey: string | null;
  signal?: AbortSignal;
}): Promise<UpstreamResult> {
  const { body, geminiApiKey, lovableApiKey, signal } = params;
  const delays = [0, 1000, 3000];
  let lastErr: unknown = null;
  let lastStatus = 0;
  let lastBodyText: string | null = null;

  // Body específico para Gemini: remove campos que a API OpenAI-compat do Gemini rejeita.
  const geminiBody: Record<string, unknown> = { ...body };
  delete geminiBody.frequency_penalty;
  delete geminiBody.presence_penalty;

  // Se o circuito está aberto, pula direto pro fallback.
  if (geminiApiKey && !circuitOpen()) {
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const r = await fetch(GEMINI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${geminiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(geminiBody),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        if (r.ok) {
          recordResult(true);
          return { resp: r, mode: "normal" };
        }
        lastStatus = r.status;
        lastBodyText = await r.text().catch(() => null);
        console.warn(`[resilience] gemini non-ok status=${r.status} body=${lastBodyText?.slice(0, 300)}`);
        recordResult(false);
        // Retry apenas em 429 / 5xx; qualquer outro erro cai pro fallback.
        if (r.status === 429 || r.status >= 500) continue;
        break;
      } catch (e) {
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
        lastErr = e;
        recordResult(false);
      }
    }
  }

  // Fallback: mesmo modelo via Lovable AI Gateway (redundância de rota).
  if (!lovableApiKey) {
    throw new Error(
      `gemini failed (status=${lastStatus}, err=${String(lastErr)}, body=${lastBodyText?.slice(0, 200)}) e LOVABLE_API_KEY ausente`,
    );
  }
  console.log("[resilience] usando fallback Lovable AI Gateway");
  const fallbackBody = {
    ...body,
    model: "google/gemini-3.1-flash-lite",
  };
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fallbackBody),
    signal,
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(
      `fallback gateway failed: ${r.status} ${errText.slice(0, 200)} (gemini prev: ${lastStatus}, err: ${String(lastErr)})`,
    );
  }
  return { resp: r, mode: "fallback" };
}

// Cache simples do system prompt por organização.
const promptCache = new Map<string, { prompt: string; expiresAt: number }>();
const PROMPT_TTL_MS = 60_000;

export function getCachedPrompt(orgId: string): string | null {
  const c = promptCache.get(orgId);
  if (c && c.expiresAt > Date.now()) return c.prompt;
  if (c) promptCache.delete(orgId);
  return null;
}

export function setCachedPrompt(orgId: string, prompt: string) {
  promptCache.set(orgId, { prompt, expiresAt: Date.now() + PROMPT_TTL_MS });
}

// ---------- Cache de respostas comuns (Fase 3) ----------

/** Normaliza a pergunta do usuário para gerar uma chave de cache estável. */
export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 hex via Web Crypto. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Define se uma resposta gerada é elegível para cache. */
export function isCacheable(fullText: string): boolean {
  if (!fullText || fullText.trim().length < 30) return false;
  if (fullText.includes("<<OPEN_TICKET_FORM>>")) return false;
  return true;
}

/** Constrói um stream SSE simulado no formato OpenAI/Groq a partir de texto pronto. */
export function buildSseStreamFromText(fullText: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const CHUNK = 24;
  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK) {
    chunks.push(fullText.slice(i, i + CHUNK));
  }
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        const payload = JSON.stringify({ choices: [{ delta: { content: c } }] });
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
        await new Promise((r) => setTimeout(r, 8));
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
