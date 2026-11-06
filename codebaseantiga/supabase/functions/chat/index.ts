import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é o ChicoChat+, atendente de TI da Prefeitura de Pedro Leopoldo.

PRINCÍPIO ABSOLUTO (VALE PARA TODA E QUALQUER CATEGORIA, TÓPICO OU ASSUNTO):
Você é um CONVERSADOR, não um manual. Independente do tema — rede, hardware, software, impressora, e-mail, sistema, acesso, senha, qualquer coisa — o comportamento é SEMPRE o mesmo:
1. Responda CURTO (máximo 3-4 linhas).
2. Faça UMA pergunta por vez para entender o problema.
3. NUNCA liste múltiplas possibilidades ou soluções de uma vez.
4. Só ofereça solução DEPOIS de entender o problema com clareza.
5. Se precisar dar passo a passo, dê UM passo por vez e espere o retorno.
Este princípio é INEGOCIÁVEL e se aplica a QUALQUER nova categoria ou tópico que surgir, presente ou futuro.

REGRA #1 — RESPOSTAS CURTAS E ESPAÇADAS:
- Cada resposta deve ter NO MÁXIMO 3-4 linhas curtas. Menos é mais.
- Separe frases com quebras de linha para facilitar a leitura.
- NUNCA despeje todas as informações de uma vez. Vá por partes.

REGRA #2 — INVESTIGUE ANTES DE RESPONDER (PARA QUALQUER ASSUNTO):
- SEMPRE faça UMA pergunta objetiva por vez para entender o problema.
- NÃO liste múltiplos cenários possíveis. Pergunte para descobrir qual é o caso.
- Só ofereça solução DEPOIS de entender o problema com clareza.
- Exemplo HARDWARE: "A tela está totalmente preta ou aparece alguma mensagem?"
- REGRA ESPECIAL REDE: Para QUALQUER problema relacionado a rede (internet, sistema, e-mail, VPN, Wi-Fi, página, impressora de rede, pasta compartilhada, etc.) — a PRIMEIRA pergunta OBRIGATÓRIA é: "Esse problema está acontecendo só com você ou com outras pessoas do setor também?" ANTES de pedir IP ou qualquer diagnóstico.
- Para QUALQUER OUTRO ASSUNTO que não seja rede nem hardware, o mesmo princípio se aplica: faça uma pergunta específica para entender o contexto antes de responder.

REGRA #3 — TOM DE VOZ:
- Fale como um colega de trabalho prestativo e paciente.
- Evite jargões técnicos. Use linguagem simples e acessível.
- Use ✅ e 💡 com moderação. Proibido humor deliberado.

REGRA #4 — IP DO COMPUTADOR:
- Em problemas de rede, internet, sistema ou impressora, peça o IP (DEPOIS de investigar).
- Oriente: "Na área de trabalho tem o arquivo 'Mostrar_IP.bat', dá dois cliques nele!"
- Se não encontrar: "Aperte a tecla Windows e digite 'Mostrar_IP'."
- NÃO oriente cmd/ipconfig.

REGRA #5 — INSISTA EM AJUDAR:
- Se não funcionou, pergunte o que aconteceu. Tente 2-3 abordagens antes de encaminhar.
- Só mencione o GLPI (https://help.pedroleopoldo.mg.gov.br/) como ÚLTIMA opção.

SEGURANÇA:
- NUNCA solicite senhas. NUNCA assuma dados não informados.

LIMITES:
- NÃO substitui atendimento presencial para defeito físico.
- NÃO acessa remotamente a máquina do usuário.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const GEMINI_API_KEY = (Deno.env.get("GEMINI_API_KEY") || "").trim();
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const CHICO_MODEL = "gemini-3.1-flash-lite";
    // Trim histórico para reduzir contexto médio (~2.5k-3k tokens).
    const rawHistory = Array.isArray(messages) ? messages : [];
    const trimmedHistory = rawHistory.slice(-16).map((m: any) => ({
      ...m,
      content:
        typeof m.content === "string" && m.content.length > 2000
          ? m.content.slice(0, 2000) + "…"
          : m.content,
    }));
    const approxTokens = (s: string) => Math.ceil((s?.length ?? 0) / 4);
    console.log("[chat] context_size_approx", {
      prompt_tokens_approx: approxTokens(SYSTEM_PROMPT),
      history_tokens_approx: trimmedHistory.reduce(
        (acc: number, m: any) => acc + approxTokens(typeof m.content === "string" ? m.content : ""),
        0,
      ),
      history_messages: trimmedHistory.length,
    });

    const t0 = Date.now();
    console.log("[chat] model_request", { model: CHICO_MODEL });
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CHICO_MODEL,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmedHistory],
          temperature: 0.2,
          top_p: 0.9,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 512,
          stream: true,
          stream_options: { include_usage: true },
        }),
      },
    );
    console.log("[chat] model_response_headers", {
      model: CHICO_MODEL,
      status: response.status,
      ttfb_ms: Date.now() - t0,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Muitas solicitações. Tente novamente em alguns instantes." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos esgotados. Adicione créditos no workspace Lovable." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text().catch(() => "");
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erro no serviço de IA. Tente novamente." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filtra blocos <think>...</think> (reasoning do Qwen) do stream SSE.
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let sseBuf = "";
    let inThink = false;
    let pending = "";
    const stripThink = (text: string, flush = false): string => {
      let s = pending + text;
      pending = "";
      let out = "";
      while (s.length > 0) {
        if (inThink) {
          const end = s.indexOf("</think>");
          if (end === -1) {
            if (!flush) pending = s.slice(-7);
            s = "";
          } else {
            s = s.slice(end + 8);
            inThink = false;
          }
        } else {
          const start = s.indexOf("<think>");
          if (start === -1) {
            if (flush) {
              out += s;
              s = "";
            } else {
              const keep = Math.min(6, s.length);
              out += s.slice(0, s.length - keep);
              pending = s.slice(s.length - keep);
              s = "";
            }
          } else {
            out += s.slice(0, start);
            s = s.slice(start + 7);
            inThink = true;
          }
        }
      }
      return out;
    };

    const filtered = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = sseBuf.indexOf("\n")) !== -1) {
              let line = sseBuf.slice(0, idx);
              sseBuf = sseBuf.slice(idx + 1);
              const hadCr = line.endsWith("\r");
              if (hadCr) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) {
                controller.enqueue(encoder.encode(line + (hadCr ? "\r\n" : "\n")));
                continue;
              }
              const json = line.slice(6).trim();
              if (json === "[DONE]") continue; // segura para emitir depois do flush
              if (!json) {
                controller.enqueue(encoder.encode(line + (hadCr ? "\r\n" : "\n")));
                continue;
              }
              try {
                const p = JSON.parse(json);
                const c = p?.choices?.[0]?.delta?.content;
                if (typeof c === "string") {
                  const out = stripThink(c);
                  if (out) {
                    p.choices[0].delta.content = out;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`));
                  }
                } else {
                  controller.enqueue(encoder.encode(line + (hadCr ? "\r\n" : "\n")));
                }
              } catch {
                controller.enqueue(encoder.encode(line + (hadCr ? "\r\n" : "\n")));
              }
            }
          }
          const tail = stripThink("", true);
          if (tail) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: tail } }] })}\n\n`),
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          console.error("[chat] stream interrompido:", e);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(filtered, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
