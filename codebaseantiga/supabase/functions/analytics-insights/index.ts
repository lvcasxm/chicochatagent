import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Period = "today" | "7d" | "30d" | "90d" | "all";

function periodToFromIso(period: Period): string | null {
  const now = Date.now();
  switch (period) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "7d": return new Date(now - 7 * 86400_000).toISOString();
    case "30d": return new Date(now - 30 * 86400_000).toISOString();
    case "90d": return new Date(now - 90 * 86400_000).toISOString();
    default: return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // valida que quem chama é admin
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: u } = await supabase.auth.getUser(token);
    const userId = u?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { period = "30d" } = await req.json().catch(() => ({}));
    const fromIso = periodToFromIso(period as Period);

    // Busca conversas no período
    let convQ = supabase.from("conversas").select("id, titulo, setor, created_at").order("created_at", { ascending: false }).limit(500);
    if (fromIso) convQ = convQ.gte("created_at", fromIso);
    const { data: conversas, error: cErr } = await convQ;
    if (cErr) throw cErr;
    const conversaIds = (conversas ?? []).map((c: any) => c.id);

    let mensagens: any[] = [];
    if (conversaIds.length > 0) {
      // pagina mensagens em chunks de 200 ids
      for (let i = 0; i < conversaIds.length; i += 200) {
        const chunk = conversaIds.slice(i, i + 200);
        const { data, error } = await supabase
          .from("mensagens")
          .select("conversa_id, role, conteudo, created_at")
          .in("conversa_id", chunk)
          .order("created_at", { ascending: true });
        if (error) throw error;
        mensagens.push(...(data ?? []));
      }
    }

    // Tickets do período (para correlacionar)
    let tQ = supabase.from("tickets").select("conversa_id, categoria, setor, titulo, status, created_at").limit(2000);
    if (fromIso) tQ = tQ.gte("created_at", fromIso);
    const { data: tickets } = await tQ;

    // Monta corpus compacto: só mensagens do usuário (primeiras N por conversa)
    const byConv = new Map<string, any[]>();
    mensagens.forEach((m) => {
      const arr = byConv.get(m.conversa_id) ?? [];
      arr.push(m);
      byConv.set(m.conversa_id, arr);
    });

    const corpus: string[] = [];
    let totalUserMsgs = 0;
    for (const c of conversas ?? []) {
      const msgs = byConv.get(c.id) ?? [];
      const userMsgs = msgs.filter((m) => m.role === "user").slice(0, 4).map((m) => (m.conteudo || "").trim()).filter(Boolean);
      if (userMsgs.length === 0) continue;
      totalUserMsgs += userMsgs.length;
      const setor = c.setor ? ` [setor: ${c.setor}]` : "";
      corpus.push(`- (${c.titulo || "sem título"})${setor}\n  • ${userMsgs.join("\n  • ")}`);
      if (corpus.join("\n").length > 60000) break; // proteção de tamanho de prompt
    }

    if (corpus.length === 0) {
      return new Response(JSON.stringify({
        period,
        generated_at: new Date().toISOString(),
        total_conversas: conversas?.length ?? 0,
        total_mensagens_usuario: 0,
        insights: [],
        summary: "Sem conversas suficientes no período para gerar análise.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = (Deno.env.get("LOVABLE_API_KEY") || "").trim();
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Você é um analista de suporte de TI da Prefeitura de Pedro Leopoldo. Receberá uma amostra de mensagens reais de servidores enviadas ao chatbot ChicoChat+ em um período. Sua tarefa: identificar e RESUMIR os principais problemas e dúvidas recorrentes.

Regras:
- Responda APENAS chamando a função "analise_suporte".
- Agrupe por TEMA (ex: senha, rede, impressora, SEI, GRP/Sonner, acesso a sistemas, hardware, e-mail, instalação, outros).
- Para cada tema, conte aproximadamente quantas conversas se enquadram (estimativa).
- Seja objetivo, em português do Brasil, linguagem institucional.
- Identifique padrões úteis para a gestão (ex: "muitos pedidos de acesso ao GRP após troca de gestão", "impressoras do setor X falhando").
- No campo summary, escreva 2-3 frases executivas.`;

    const userPrompt = `Período: ${period}\nTotal de conversas: ${conversas?.length ?? 0}\nTotal de mensagens de usuário analisadas: ${totalUserMsgs}\n\nAmostra de conversas:\n${corpus.join("\n\n")}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "analise_suporte",
            description: "Retorna análise estruturada dos principais problemas/dúvidas do período.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Resumo executivo de 2-3 frases." },
                insights: {
                  type: "array",
                  description: "Lista dos principais temas, ordenados do mais frequente ao menos frequente.",
                  items: {
                    type: "object",
                    properties: {
                      tema: { type: "string", description: "Nome curto do tema (ex: Redefinição de senha)." },
                      descricao: { type: "string", description: "1-2 frases descrevendo o padrão observado." },
                      estimativa_conversas: { type: "number", description: "Quantidade aproximada de conversas." },
                      severidade: { type: "string", enum: ["baixa", "media", "alta"], description: "Impacto operacional." },
                      exemplos: { type: "array", items: { type: "string" }, description: "1-3 trechos curtos representativos." },
                      recomendacao: { type: "string", description: "Ação sugerida à equipe de TI." },
                    },
                    required: ["tema", "descricao", "estimativa_conversas", "severidade"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "insights"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "analise_suporte" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text().catch(() => "");
      console.error("AI gateway error:", aiResp.status, t);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Muitas solicitações. Tente novamente em alguns instantes." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos esgotados na IA." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway ${aiResp.status}`);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : null;
    if (!args) throw new Error("Resposta da IA sem tool_call");

    return new Response(JSON.stringify({
      period,
      generated_at: new Date().toISOString(),
      total_conversas: conversas?.length ?? 0,
      total_mensagens_usuario: totalUserMsgs,
      total_tickets: tickets?.length ?? 0,
      summary: args.summary,
      insights: args.insights,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analytics-insights error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
