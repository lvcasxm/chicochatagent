// Edge function: detecção amigável de possíveis chamados duplicados
// antes da abertura definitiva no GLPI.
//
// Estratégia: consulta a tabela `tickets` (registrada pelo próprio
// glpi-ticket após cada abertura bem-sucedida) nos últimos 7 dias e
// calcula similaridade Jaccard entre o texto atual e (titulo + motivo)
// dos tickets anteriores. Retorna os candidatos com score acima do
// threshold + um sinal de incidente coletivo quando vários usuários
// distintos abriram tickets parecidos em janela curta.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GLPI_BASE = "https://suporte.pedroleopoldo.mg.gov.br";
const WINDOW_DAYS = 7;
const COLLECTIVE_WINDOW_HOURS = 2;
// Limiar textual (Jaccard). Mantemos baixo porque os corpora costumam ser
// curtos e com vocabulário irregular entre conversas do mesmo usuário.
const PERSONAL_THRESHOLD = 0.18;
const COLLECTIVE_THRESHOLD = 0.28;
const COLLECTIVE_MIN_USERS = 3;
const MAX_RESULTS = 3;
// Regra forte: mesmo usuário + mesma categoria nessa janela = sempre avisa,
// independentemente da similaridade textual. Cobre o caso clássico de
// "abri o mesmo chamado de novo" minutos depois.
const SAME_CATEGORY_WINDOW_HOURS = 4;
// Janela curta usada para boost de recência (tickets muito recentes pesam mais).
const RECENT_BOOST_HOURS = 2;

const STOPWORDS = new Set<string>([
  "a","o","as","os","um","uma","uns","umas","de","do","da","dos","das","em","no","na","nos","nas",
  "para","por","com","sem","que","se","ao","aos","e","ou","mas","como","ja","muito",
  "esta","este","estou","estamos","sou","somos","ser","tem","temos","ter","foi","fui","era",
  "ele","ela","eles","elas","meu","minha","seu","sua","nos","voces","voce","aqui",
  "ali","la","quando","onde","quem","qual","quais","isso","isto","aquilo","tudo","nada","sim",
  "nao","so","mais","menos","bem","melhor","pior","tao","entre","sobre","apos",
  "antes","agora","hoje","ontem","amanha","ainda","sempre","nunca","talvez","preciso","precisava",
  "queria","quero","gostaria","favor","obrigado","obrigada","oi","ola","bom","boa","dia","tarde","noite",
]);

function normalize(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): Set<string> {
  return new Set(
    normalize(input)
      .split(" ")
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function timeAgoPt(date: string): string {
  const then = new Date(date).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

interface RequestBody {
  user_id?: string | null;
  email?: string | null;
  setor?: string | null;
  selected_category?: string | null;
  text?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    const text = (body.text || "").trim();
    if (!text || text.length < 4) {
      return new Response(
        JSON.stringify({ duplicates: [], collective_incident: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Normaliza e-mail (lowercase + trim) para casar mesmo com variações de digitação.
    const normalizedEmail = (body.email || "").trim().toLowerCase();

    // Tickets do próprio usuário (por user_id OU e-mail) nos últimos 7d.
    const userFilters: string[] = [];
    if (body.user_id) userFilters.push(`user_id.eq.${body.user_id}`);
    if (normalizedEmail) userFilters.push(`email.eq.${normalizedEmail}`);

    let ownTickets: any[] = [];
    if (userFilters.length > 0) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, glpi_ticket_id, titulo, categoria, motivo, setor, created_at, status, user_id, email")
        .eq("status", "success")
        .gte("created_at", sinceIso)
        .or(userFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) console.warn("[duplicate-check] own tickets error:", error.message);
      ownTickets = data ?? [];
    }

    // Tickets globais recentes (todos os usuários) para detecção de incidente coletivo (últimas N horas).
    const collectiveSinceIso = new Date(Date.now() - COLLECTIVE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recentGlobal, error: globalErr } = await supabase
      .from("tickets")
      .select("id, glpi_ticket_id, titulo, categoria, user_id, setor, created_at")
      .eq("status", "success")
      .gte("created_at", collectiveSinceIso)
      .order("created_at", { ascending: false })
      .limit(200);
    if (globalErr) console.warn("[duplicate-check] global tickets error:", globalErr.message);

    const currentTokens = tokenize(`${body.selected_category || ""} ${text}`);
    const currentCategoryNorm = normalize(body.selected_category || "");
    const now = Date.now();
    const sameCategoryWindowMs = SAME_CATEGORY_WINDOW_HOURS * 60 * 60 * 1000;
    const recentBoostMs = RECENT_BOOST_HOURS * 60 * 60 * 1000;

    // 1. Score em tickets do próprio usuário
    const ranked = ownTickets
      .map((t) => {
        const corpus = `${t.titulo || ""} ${t.motivo || ""} ${t.categoria || ""}`;
        const baseScore = jaccard(currentTokens, tokenize(corpus));
        const ageMs = now - new Date(t.created_at).getTime();
        const ticketCategoryNorm = normalize(t.categoria || "");

        // Regra forte: mesma categoria + mesmo usuário + janela curta -> sempre avisa.
        const sameCategoryRecent =
          currentCategoryNorm &&
          ticketCategoryNorm &&
          currentCategoryNorm === ticketCategoryNorm &&
          ageMs <= sameCategoryWindowMs;

        // Boost de recência: tickets muito recentes ganham até +0.15 no score.
        let score = baseScore;
        if (ageMs <= recentBoostMs) {
          const boost = 0.15 * (1 - ageMs / recentBoostMs);
          score = Math.min(1, score + boost);
        }
        // Garante score mínimo confortável acima do threshold quando a regra
        // forte de categoria dispara, mesmo que o texto seja muito diferente.
        if (sameCategoryRecent) {
          score = Math.max(score, 0.55);
        }

        return { ticket: t, score, sameCategoryRecent };
      })
      .filter((r) => r.sameCategoryRecent || r.score >= PERSONAL_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map(({ ticket, score }) => ({
        glpi_ticket_id: ticket.glpi_ticket_id,
        titulo: ticket.titulo,
        categoria: ticket.categoria,
        setor: ticket.setor,
        created_at: ticket.created_at,
        opened_label: timeAgoPt(ticket.created_at),
        url: ticket.glpi_ticket_id
          ? `${GLPI_BASE}/front/ticket.form.php?id=${ticket.glpi_ticket_id}`
          : null,
        score,
      }));

    // 2. Incidente coletivo: tickets parecidos de usuários DIFERENTES na janela curta.
    let collective: {
      count: number;
      categoria: string | null;
      since_label: string;
      sample_titles: string[];
    } | null = null;

    if (recentGlobal && recentGlobal.length > 0) {
      const distinctUsers = new Set<string>();
      const matched: any[] = [];
      for (const t of recentGlobal) {
        const corpus = `${t.titulo || ""} ${t.categoria || ""}`;
        if (jaccard(currentTokens, tokenize(corpus)) >= COLLECTIVE_THRESHOLD) {
          matched.push(t);
          if (t.user_id) distinctUsers.add(String(t.user_id));
        }
      }
      if (distinctUsers.size >= COLLECTIVE_MIN_USERS) {
        collective = {
          count: distinctUsers.size,
          categoria: matched[0]?.categoria ?? null,
          since_label: `últimas ${COLLECTIVE_WINDOW_HOURS}h`,
          sample_titles: matched.slice(0, 3).map((m) => m.titulo).filter(Boolean),
        };
      }
    }

    return new Response(
      JSON.stringify({
        duplicates: ranked,
        collective_incident: collective,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[ticket-duplicate-check] error:", e);
    // Falha sempre como "sem duplicidade" para não bloquear o usuário.
    return new Response(
      JSON.stringify({ duplicates: [], collective_incident: null, error: String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
