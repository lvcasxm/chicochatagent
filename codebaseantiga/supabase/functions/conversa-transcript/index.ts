import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOKEN_REGEX = /^[a-f0-9]{16,80}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let token = "";
    if (req.method === "GET") {
      token = new URL(req.url).searchParams.get("token") ?? "";
    } else {
      const body = await req.json().catch(() => ({}));
      token = typeof body?.token === "string" ? body.token : "";
    }
    token = token.trim();

    if (!TOKEN_REGEX.test(token)) {
      return new Response(JSON.stringify({ error: "Link inválido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabaseAdmin
      .from("ticket_transcripts")
      .select("token, glpi_ticket_id, nome, setor, titulo, resumo, messages, created_at")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      console.error("[conversa-transcript] erro na consulta:", error);
      return new Response(JSON.stringify({ error: "Erro ao carregar a conversa." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!data) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada ou link expirado." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages = Array.isArray(data.messages)
      ? (data.messages as Array<{ role?: string; content?: string }>)
          .filter((m) => m?.content && m.role !== "system")
          .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content) }))
      : [];

    console.log("[conversa-transcript] transcript servido:", {
      ticket: data.glpi_ticket_id,
      msgs: messages.length,
    });

    return new Response(
      JSON.stringify({
        ticket_id: data.glpi_ticket_id,
        nome: data.nome,
        setor: data.setor,
        titulo: data.titulo,
        resumo: data.resumo,
        created_at: data.created_at,
        messages,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[conversa-transcript] erro inesperado:", e);
    return new Response(JSON.stringify({ error: "Erro inesperado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
