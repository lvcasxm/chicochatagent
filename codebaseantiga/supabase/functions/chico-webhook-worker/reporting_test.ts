import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliveryDecision, publicPayload, sessionPayload, matchesSecret } from "../_shared/chico-reporting.ts";

Deno.test("delivery requires explicit success, never HTML or error", () => {
  assertEquals(deliveryDecision(200, { success: true }).accepted, true);
  assertEquals(deliveryDecision(200, { ok: true }).accepted, true);
  assertEquals(deliveryDecision(200, null).accepted, false);
  assertEquals(deliveryDecision(200, { error: "invalid token" }).accepted, false);
  assertEquals(deliveryDecision(429, null).retryable, true);
  assertEquals(deliveryDecision(503, null).retryable, true);
  assertEquals(deliveryDecision(401, null).accepted, false);
});

Deno.test("report excludes all non-allowlisted fields", async () => {
  const safe = await publicPayload({ id_sessao: "check", dt_inicio: "2026-10-13T00:00:00Z", nome: "private", email: "private", ip: "private", conteudo: "private", token: "private" });
  assertEquals(Object.keys(safe).sort(), ["dt_inicio", "id_sessao", "id_usuario_hash"]);
});

Deno.test("session counts tickets and keeps unknown duration null", () => {
  assertEquals(sessionPayload({ ids_chamados_glpi: [1, 2] }).qtd_chamados, 2);
  assertEquals(sessionPayload({ dt_inicio: "2026-10-13T00:00:00Z", dt_fim: null }).duracao_seg, null);
  assertEquals(sessionPayload({ dt_inicio: "2026-10-13T00:00:00Z", dt_fim: "2026-10-13T00:01:00Z" }).duracao_seg, 60);
});

Deno.test("missing or invalid token is rejected", async () => {
  assertEquals(await matchesSecret(null, "CHICO_SHEETS_WEBHOOK_TOKEN"), false);
  assertEquals(await matchesSecret("invalid-probe", "CHICO_SHEETS_WEBHOOK_TOKEN"), false);
});

Deno.test("HMAC is stable and does not reveal user id", async () => {
  if (!Deno.env.get("CHICO_REPORTING_HASH_KEY")) return;
  const a = await publicPayload({ user_id: "test-user" });
  const b = await publicPayload({ user_id: "test-user" });
  assertEquals(a.id_usuario_hash, b.id_usuario_hash);
  assert(String(a.id_usuario_hash).length === 64);
  assertEquals(a.user_id, undefined);
});