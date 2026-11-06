import { supabase } from "@/integrations/supabase/client";

export type Msg = { role: "user" | "assistant"; content: string };

export interface GlpiTicketData {
  nome: string;
  email: string;
  setor: string;
  ip?: string;
  ip_indisponivel?: boolean;
  on_behalf?: boolean;
  beneficiary?: {
    nome: string;
    matricula?: string;
    setor: string;
  };
  /** Histórico completo da conversa para que o backend gere título e resumo via IA */
  messages?: Msg[];
  /** Categoria escolhida pelo usuário no card inicial (rótulo visível) */
  selected_category?: string | null;
  /** Metadados para analytics */
  user_id?: string | null;
  agent_slug?: string | null;
  conversa_id?: string | null;
  /** Modo de teste: pula geração via IA e usa título/categoria fixos de teste (admin only) */
  test_mode?: boolean;
}

const GLPI_TICKET_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/glpi-ticket`;


const AGENT_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`;

export async function getAgentInfo(slug: string) {
  // Retenta falhas de rede/servidor passageiras (ex.: backend acordando após pausa).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500));
    try {
      const resp = await fetch(AGENT_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ slug, action: "init" }),
      });
      if (resp.ok) return resp.json();
      lastErr = new Error("Erro ao buscar informações do agente.");
      if (resp.status < 500 && resp.status !== 429) break;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Erro ao buscar informações do agente.");
}

export async function streamAgentChat({
  slug,
  messages,
  signal,
  onMode,
  onDelta,
  onDone,
  onError,
}: {
  slug: string;
  messages: Msg[];
  signal?: AbortSignal;
  onMode?: (mode: string) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string, meta?: { status?: number; retryAfterMs?: number }) => void;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  let resp: Response;
  try {
    resp = await fetch(AGENT_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ slug, messages, action: "chat" }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return;
    onError("Erro de conexão. Verifique sua internet e tente novamente.");
    return;
  }

  const mode = resp.headers.get("X-Chico-Mode") || "normal";
  onMode?.(mode);

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({} as any));
    onError(data.error || "Erro ao conectar com o agente.", {
      status: resp.status,
      retryAfterMs: data.retryAfterMs,
    });
    return;
  }

  if (!resp.body) {
    onError("Resposta vazia.");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let streamDone = false;

  try {
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") { streamDone = true; break; }
        try {
          const p = JSON.parse(json);
          const c = p.choices?.[0]?.delta?.content;
          if (c) onDelta(c);
        } catch {
          buf = line + "\n" + buf;
          break;
        }
      }
    }

    if (buf.trim()) {
      for (let raw of buf.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data: ")) continue;
        const json = raw.slice(6).trim();
        if (json === "[DONE]") continue;
        try {
          const p = JSON.parse(json);
          const c = p.choices?.[0]?.delta?.content;
          if (c) onDelta(c);
        } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return;
    onError("Conexão interrompida. Tente novamente.");
    return;
  }

  onDone();
}

/** Submit ticket to GLPI via edge function */
export async function submitGlpiTicket(data: GlpiTicketData): Promise<{ success: boolean; ticket_id?: string; message?: string; error?: string }> {
  const resp = await fetch(GLPI_TICKET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(data),
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return {
      success: false,
      error: payload.error || "Erro ao abrir chamado. Tente novamente.",
    };
  }
  return payload;
}
