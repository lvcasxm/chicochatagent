import { createClient } from "npm:@supabase/supabase-js@2";

export function reportingClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Reporting configuration unavailable");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function matchesSecret(value: string | null, name: string) {
  const expected = Deno.env.get(name);
  if (!expected || !value) return false;
  const digest = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const a = new Uint8Array(await digest(value));
  const b = new Uint8Array(await digest(expected));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function publicPayload(payload: Record<string, unknown>) {
  const allowed = ["id_sessao", "id_tentativa", "dt_inicio", "dt_fim", "qtd_mensagens", "duracao_seg", "intencao", "resolvida", "escalonada", "elegivel", "nota", "qtd_chamados", "ids_chamados_glpi", "dt_carga", "dt_tentativa", "sucesso", "id_chamado_glpi", "codigo_erro", "mensagem_erro"];
  const safe: Record<string, unknown> = Object.fromEntries(allowed.filter((k) => k in payload).map((k) => [k, payload[k]]));
  const identity = payload._user_id ?? payload.user_id;
  if (identity) {
    const secret = Deno.env.get("CHICO_REPORTING_HASH_KEY");
    if (!secret) throw new Error("Reporting hash configuration unavailable");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(identity))));
    safe.id_usuario_hash = Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
  } else if ("dt_inicio" in safe) safe.id_usuario_hash = null;
  return safe;
}

export function sessionPayload(s: Record<string, unknown>) {
  const ids = Array.isArray(s.ids_chamados_glpi) ? s.ids_chamados_glpi : [];
  return {
    id_sessao: s.id_sessao, _user_id: s.user_id, dt_inicio: s.dt_inicio, dt_fim: s.dt_fim,
    qtd_mensagens: s.qtd_mensagens,
    duracao_seg: s.dt_fim ? Math.max(0, Math.floor((Date.parse(String(s.dt_fim)) - Date.parse(String(s.dt_inicio))) / 1000)) : null,
    intencao: s.intencao, resolvida: s.historica ? null : s.resolvida, escalonada: s.escalonada,
    elegivel: s.historica ? null : s.elegivel, nota: s.nota, qtd_chamados: ids.length, ids_chamados_glpi: ids, dt_carga: s.updated_at,
  };
}

export function deliveryDecision(status: number, body: unknown) {
  const result = body as { success?: boolean; ok?: boolean; status?: string } | null;
  const accepted = status >= 200 && status < 300 && !!result
    && (result.success === true || result.ok === true || result.status === "success");
  return { accepted, retryable: status === 429 || status >= 500 || (status >= 200 && status < 300 && !accepted) };
}