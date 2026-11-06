import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { matchesSecret, publicPayload, reportingClient, sessionPayload } from "../_shared/chico-reporting.ts";

const Input = z.object({
  token: z.string().min(1).max(512),
  desde: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
  tipo: z.enum(["sessoes", "chamados"]).default("sessoes"),
  offset: z.number().int().min(0).max(10000000).default(0),
  limite: z.number().int().min(1).max(500).default(200),
}).strict();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid export parameters" }, 400);
  if (!await matchesSecret(parsed.data.token, "CHICO_SHEETS_WEBHOOK_TOKEN")) return json({ error: "Unauthorized" }, 401);
  const { tipo, offset, limite } = parsed.data;
  const ate = parsed.data.ate ?? new Date().toISOString();
  const desde = parsed.data.desde ?? new Date(Date.parse(ate) - 48 * 3600000).toISOString();
  if (Date.parse(desde) > Date.parse(ate)) return json({ error: "Invalid date interval" }, 400);
  try {
    const table = tipo === "sessoes" ? "chico_reporting_sessions" : "chico_reporting_attempts";
    const key = tipo === "sessoes" ? "id_sessao" : "id_tentativa";
    let query = reportingClient().from(table).select("*").gte("updated_at", desde).lte("updated_at", ate)
      .order("updated_at").order(key).range(offset, offset + limite);
    if (tipo === "sessoes") query = query.not("dt_fim", "is", null);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    const registros = await Promise.all(rows.slice(0, limite).map(async (row) => {
      if (tipo === "sessoes") return publicPayload(sessionPayload(row));
      return { ...await publicPayload(row), dt_carga: row.updated_at };
    }));
    return json({ success: true, tipo, desde, ate, registros, proximo_offset: rows.length > limite ? offset + limite : null,
      observacao: "Registros históricos sem informação de resolução, elegibilidade ou nota usam null; não são estimados." });
  } catch { return json({ error: "Export failed" }, 500); }
});