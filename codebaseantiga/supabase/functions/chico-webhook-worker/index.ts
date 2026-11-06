import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { matchesSecret, publicPayload, reportingClient, deliveryDecision } from "../_shared/chico-reporting.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!await matchesSecret(req.headers.get("X-Chico-Worker-Token"), "CHICO_SHEETS_WEBHOOK_TOKEN")) return json({ error: "Unauthorized" }, 401);
  try {
    const url = Deno.env.get("CHICO_SHEETS_WEBHOOK_URL");
    const token = Deno.env.get("CHICO_SHEETS_WEBHOOK_TOKEN");
    if (!url || !token || new URL(url).hostname !== "script.google.com") return json({ error: "Webhook configuration unavailable" }, 503);
    const db = reportingClient();
    const { data: rows, error } = await db.rpc("chico_claim_webhooks");
    if (error) throw error;
    let delivered = 0;
    for (const row of rows ?? []) {
      let accepted = false;
      let retryable = true;
      let safeError = "Falha de conexão com a planilha.";
      let retryAfter = 0;
      try {
        const payload = await publicPayload(row.payload);
        // Apps Script redirects its response to script.googleusercontent.com.
        const response = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, evento: row.evento, token }),
          signal: AbortSignal.timeout(15000), redirect: "follow",
        });
        const text = await response.text();
        let body: unknown = null;
        try { body = JSON.parse(text); } catch { /* A Google login page is not success. */ }
        ({ accepted, retryable } = deliveryDecision(response.status, body));
        safeError = `Planilha não confirmou recebimento (HTTP ${response.status}).`;
        const header = response.headers.get("Retry-After");
        if (header) retryAfter = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now());
      } catch { /* Never log response bodies or shared tokens. */ }
      const attempts = row.attempts + 1;
      const delay = Math.max(retryAfter || 0, [5000, 15000, 45000][attempts - 1] ?? 45000);
      const { error: saveError } = await db.from("chico_webhook_outbox").update({
        attempts: accepted || retryable ? attempts : 4,
        delivered_at: accepted ? new Date().toISOString() : null,
        locked_until: null, available_at: new Date(Date.now() + delay).toISOString(),
        last_error: accepted ? null : safeError,
        // updated_at belongs to the payload revision, not delivery status.
      }).eq("id", row.id).eq("updated_at", row.updated_at);
      if (saveError) throw saveError;
      if (accepted) delivered++;
    }
    return json({ success: true, processed: rows?.length ?? 0, delivered });
  } catch {
    return json({ error: "Reporting processing failed" }, 500);
  }
});