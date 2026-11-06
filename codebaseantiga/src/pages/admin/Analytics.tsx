import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, Users, MessageSquare, Ticket, TrendingUp, Star, AlertCircle, CheckCircle2, Clock, ExternalLink,
  Download, Sparkles, Loader2, RefreshCw,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { periodToFromDate, dayKey, buildDateBuckets, type Period } from "@/lib/analytics";
import { toCsv, downloadCsv, timestampForFile } from "@/lib/csv-export";

const GLPI_DIRECT_URL = "https://suporte.pedroleopoldo.mg.gov.br/";

type Conversa = { id: string; user_id: string; org_slug: string | null; titulo: string | null; created_at: string; updated_at: string; session_id: string | null; setor: string | null; };
type Mensagem = { id: string; conversa_id: string; role: string; conteudo: string; created_at: string; };
type TicketRow = { id: string; user_id: string | null; agent_slug: string | null; conversa_id: string | null; glpi_ticket_id: string | null; status: string; setor: string | null; titulo: string | null; categoria: string | null; created_at: string; nome: string | null; email: string | null; error_message: string | null; };
type Feedback = { id: string; user_id: string; org_slug: string | null; conversa_id: string | null; rating: number; sugestao: string | null; ticket_id: string | null; created_at: string; };
type AEvent = { id: string; session_id: string; conversa_id: string | null; user_id: string | null; org_slug: string | null; event_type: string; category: string | null; setor: string | null; metadata: any; created_at: string; };

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "all", label: "Tudo" },
];

const CHART_COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export default function Analytics() {
  const [period, setPeriod] = useState<Period>("30d");
  const [failuresOpen, setFailuresOpen] = useState(false);
  const fromDate = useMemo(() => periodToFromDate(period), [period]);
  const fromIso = fromDate?.toISOString() ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-v2", period],
    queryFn: async () => {
      const PAGE = 1000;
      async function fetchAll<T>(table: string, dateCol = "created_at"): Promise<T[]> {
        const out: T[] = [];
        let from = 0;
        for (let i = 0; i < 50; i++) {
          let q = supabase.from(table as any).select("*").order(dateCol, { ascending: false }).range(from, from + PAGE - 1);
          if (fromIso) q = q.gte(dateCol, fromIso);
          const { data, error } = await q;
          if (error) throw error;
          const rows = (data ?? []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        return out;
      }

      const [conversas, mensagens, tickets, feedbacks, events, sessions] = await Promise.all([
        fetchAll<Conversa>("conversas"),
        fetchAll<Mensagem>("mensagens"),
        fetchAll<TicketRow>("tickets"),
        fetchAll<Feedback>("feedbacks"),
        fetchAll<AEvent>("analytics_events"),
        fetchAll<{ id: string; user_id: string; email: string | null; full_name: string | null; created_at: string }>("user_sessions"),
      ]);

      return { conversas, mensagens, tickets, feedbacks, events, sessions };
    },
  });

  const stats = useMemo(() => {
    if (!data) return null;
    const { conversas, mensagens, tickets, feedbacks, sessions } = data;

    // Sessions = distinct session_id from conversas (fallback: conversa.id se sem session_id)
    const sessionIds = new Set<string>();
    conversas.forEach((c) => sessionIds.add(c.session_id || c.id));

    // Usuários únicos = qualquer pessoa que logou OU conversou no período
    const userSet = new Set<string>();
    sessions.forEach((s) => userSet.add(s.user_id));
    conversas.forEach((c) => userSet.add(c.user_id));

    const totalConversas = conversas.length;
    const totalSessions = sessionIds.size;
    const totalMessages = mensagens.length;
    const ticketsSuccess = tickets.filter((t) => t.status === "success").length;
    const failedTickets = tickets.filter((t) => t.status !== "success").length;

    // Sessions com ticket vs sem
    const sessionByConv = new Map<string, string>();
    conversas.forEach((c) => sessionByConv.set(c.id, c.session_id || c.id));
    const sessionsWithTicket = new Set<string>();
    tickets.filter((t) => t.status === "success" && t.conversa_id).forEach((t) => {
      const sid = sessionByConv.get(t.conversa_id as string);
      if (sid) sessionsWithTicket.add(sid);
    });

    const escalationRate = totalSessions > 0 ? (sessionsWithTicket.size / totalSessions) * 100 : 0;
    const resolutionRate = totalSessions > 0 ? ((totalSessions - sessionsWithTicket.size) / totalSessions) * 100 : 0;

    const ratings = feedbacks.map((f) => f.rating);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    // Tempo médio de atendimento por sessão = (última msg - primeira msg) na sessão
    const msgsBySession = new Map<string, { first: number; last: number }>();
    mensagens.forEach((m) => {
      const sid = sessionByConv.get(m.conversa_id);
      if (!sid) return;
      const t = new Date(m.created_at).getTime();
      const cur = msgsBySession.get(sid);
      if (!cur) msgsBySession.set(sid, { first: t, last: t });
      else { cur.first = Math.min(cur.first, t); cur.last = Math.max(cur.last, t); }
    });
    const durations = Array.from(msgsBySession.values()).map((s) => Math.max(0, s.last - s.first));
    const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      uniqueUsers: userSet.size,
      totalSessions,
      totalConversas,
      totalMessages,
      ticketsSuccess,
      failedTickets,
      escalationRate,
      resolutionRate,
      avgRating,
      totalFeedbacks: feedbacks.length,
      avgDurationMs,
    };
  }, [data]);

  // Time series: sessions/users/tickets per day
  const timeSeries = useMemo(() => {
    if (!data) return [];
    const buckets = buildDateBuckets(fromDate);
    const map = new Map<string, { date: string; sessoes: Set<string>; usuarios: Set<string>; tickets: number }>();
    buckets.forEach((d) => map.set(d, { date: d, sessoes: new Set(), usuarios: new Set(), tickets: 0 }));

    data.conversas.forEach((c) => {
      const k = dayKey(c.created_at);
      const b = map.get(k);
      if (b) { b.sessoes.add(c.session_id || c.id); b.usuarios.add(c.user_id); }
    });
    data.tickets.filter((t) => t.status === "success").forEach((t) => {
      const k = dayKey(t.created_at);
      const b = map.get(k);
      if (b) b.tickets++;
    });

    return Array.from(map.values()).map((b) => ({
      date: b.date.slice(5),
      sessoes: b.sessoes.size,
      usuarios: b.usuarios.size,
      chamados: b.tickets,
    }));
  }, [data, fromDate]);

  // Por categoria (eventos category_detected ou ticket categoria)
  const byCategory = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    data.events.filter((e) => e.event_type === "category_detected" && e.category).forEach((e) => {
      const k = e.category as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    // Fallback: tickets com categoria, caso ainda não haja eventos
    if (counts.size === 0) {
      data.tickets.filter((t) => t.categoria).forEach((t) => {
        const k = t.categoria as string;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      });
    }
    return Array.from(counts.entries())
      .map(([categoria, count]) => ({ categoria, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data]);

  // Por setor (somente quando há chamado — vem da conversa.setor ou ticket.setor)
  const bySector = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    data.tickets.filter((t) => t.status === "success").forEach((t) => {
      const k = (t.setor || "Não informado").trim();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([setor, count]) => ({ setor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data]);

  // Distribuição de notas (1..5)
  const ratingDist = useMemo(() => {
    const base = [1, 2, 3, 4, 5].map((r) => ({ rating: `${r}★`, count: 0 }));
    if (!data) return base;
    data.feedbacks.forEach((f) => {
      const i = (f.rating ?? 0) - 1;
      if (i >= 0 && i < 5) base[i].count++;
    });
    return base;
  }, [data]);

  // Funil
  const funnel = useMemo(() => {
    if (!data || !stats) return [];
    const conversasComResposta = new Set(
      data.mensagens.filter((m) => m.role === "assistant").map((m) => m.conversa_id),
    );
    const sessionByConv = new Map<string, string>();
    data.conversas.forEach((c) => sessionByConv.set(c.id, c.session_id || c.id));
    const sessoesComResposta = new Set<string>();
    conversasComResposta.forEach((cid) => {
      const sid = sessionByConv.get(cid);
      if (sid) sessoesComResposta.add(sid);
    });
    const sessoesEscaladas = new Set<string>();
    data.tickets.filter((t) => t.status === "success" && t.conversa_id).forEach((t) => {
      const sid = sessionByConv.get(t.conversa_id as string);
      if (sid) sessoesEscaladas.add(sid);
    });

    return [
      { etapa: "Usuários únicos", valor: stats.uniqueUsers },
      { etapa: "Sessões iniciadas", valor: stats.totalSessions },
      { etapa: "Sessões com resposta do bot", valor: sessoesComResposta.size },
      { etapa: "Sessões escaladas", valor: sessoesEscaladas.size },
      { etapa: "Chamados abertos", valor: stats.ticketsSuccess },
    ];
  }, [data, stats]);

  // Conversas recentes (agrupadas por session_id)
  const recentSessions = useMemo(() => {
    if (!data) return [];
    const bySession = new Map<string, { sid: string; user_id: string; convs: Conversa[]; firstAt: string; lastAt: string }>();
    data.conversas.forEach((c) => {
      const sid = c.session_id || c.id;
      const cur = bySession.get(sid);
      if (!cur) {
        bySession.set(sid, { sid, user_id: c.user_id, convs: [c], firstAt: c.created_at, lastAt: c.updated_at });
      } else {
        cur.convs.push(c);
        if (c.created_at < cur.firstAt) cur.firstAt = c.created_at;
        if (c.updated_at > cur.lastAt) cur.lastAt = c.updated_at;
      }
    });
    const ticketByConv = new Map<string, TicketRow>();
    data.tickets.forEach((t) => { if (t.conversa_id) ticketByConv.set(t.conversa_id, t); });

    return Array.from(bySession.values())
      .sort((a, b) => new Date(b.firstAt).getTime() - new Date(a.firstAt).getTime())
      .slice(0, 30)
      .map((s) => {
        const ticket = s.convs.map((c) => ticketByConv.get(c.id)).find(Boolean);
        const titulo = s.convs.find((c) => c.titulo)?.titulo || "Sem título";
        const setor = s.convs.find((c) => c.setor)?.setor || ticket?.setor || null;
        return {
          sid: s.sid,
          firstAt: s.firstAt,
          titulo,
          conversas: s.convs.length,
          setor,
          ticketId: ticket?.glpi_ticket_id ?? null,
          ticketStatus: ticket?.status ?? null,
        };
      });
  }, [data]);

  const failedTicketsList = useMemo(() => {
    if (!data) return [] as TicketRow[];
    return data.tickets
      .filter((t) => t.status !== "success")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [data]);

  const fmtDuration = (ms: number) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-['Space_Grotesk']">Analytics operacional</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Métricas baseadas em sessões (timeout de 30 min de inatividade) e eventos estruturados.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ExportMenu data={data} period={period} />
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              {PERIOD_OPTIONS.map((opt) => (
                <TabsTrigger key={opt.value} value={opt.value}>{opt.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      <AiInsightsCard period={period} />

      {isLoading || !stats ? (
        <div className="text-muted-foreground">Carregando…</div>
      ) : (
        <>
          {/* KPI cards */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard icon={Users} label="Usuários únicos" value={stats.uniqueUsers} />
            <KpiCard icon={Activity} label="Sessões" value={stats.totalSessions} />
            <KpiCard icon={MessageSquare} label="Mensagens" value={stats.totalMessages} />
            <KpiCard icon={Ticket} label="Chamados abertos" value={stats.ticketsSuccess} />
            <KpiCard icon={CheckCircle2} label="Taxa de resolução" value={`${stats.resolutionRate.toFixed(1)}%`} />
            <KpiCard icon={TrendingUp} label="Taxa de escalonamento" value={`${stats.escalationRate.toFixed(1)}%`} />
            <KpiCard icon={Star} label="Nota média" value={stats.avgRating > 0 ? stats.avgRating.toFixed(2) : "—"} />
            <KpiCard icon={Clock} label="Tempo médio/sessão" value={stats.avgDurationMs > 0 ? fmtDuration(stats.avgDurationMs) : "—"} />
            <KpiCard
              icon={AlertCircle}
              label="Falhas ao abrir chamado"
              value={stats.failedTickets}
              hint={stats.failedTickets > 0 ? "Clique para ver detalhes" : undefined}
              onClick={stats.failedTickets > 0 ? () => setFailuresOpen(true) : undefined}
            />
          </section>

          {/* Time series */}
          <Card>
            <CardHeader><CardTitle className="text-base">Evolução diária</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="sessoes" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} name="Sessões" />
                  <Line type="monotone" dataKey="usuarios" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} name="Usuários" />
                  <Line type="monotone" dataKey="chamados" stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} name="Chamados" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Funnel + Category */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Funil de atendimento</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {funnel.map((step, i) => {
                  const max = funnel[0]?.valor || 1;
                  const pct = (step.valor / max) * 100;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium">{step.etapa}</span>
                        <span className="text-muted-foreground">{step.valor}</span>
                      </div>
                      <div className="h-3 rounded bg-muted overflow-hidden">
                        <div className="h-full transition-all" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Por categoria</CardTitle></CardHeader>
              <CardContent className="h-72">
                {byCategory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byCategory} layout="vertical" margin={{ left: 90 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis dataKey="categoria" type="category" tick={{ fontSize: 10 }} width={130} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {byCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chamados por setor</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Apenas conversas que viraram chamado têm setor informado.</p>
            </CardHeader>
            <CardContent className="h-72">
              {bySector.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem chamados no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bySector} layout="vertical" margin={{ left: 90 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="setor" type="category" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip />
                    <Bar dataKey="count" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Distribuição de notas */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distribuição de notas</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Quantidade de avaliações por nota (1 a 5).</p>
            </CardHeader>
            <CardContent className="h-72">
              {ratingDist.every((r) => r.count === 0) ? (
                <p className="text-sm text-muted-foreground">Sem avaliações no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ratingDist}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="rating" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {ratingDist.map((_, i) => (
                        <Cell key={i} fill={["#ef4444", "#f59e0b", "#eab308", "#84cc16", "#10b981"][i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Recent sessions */}
          <Card>
            <CardHeader><CardTitle className="text-base">Sessões recentes</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Início</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead className="text-right">Conversas</TableHead>
                      <TableHead>Setor</TableHead>
                      <TableHead>Resultado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentSessions.map((r) => (
                      <TableRow key={r.sid}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(r.firstAt), "dd/MM HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate" title={r.titulo}>{r.titulo}</TableCell>
                        <TableCell className="text-xs text-right">{r.conversas}</TableCell>
                        <TableCell className="text-xs">{r.setor || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {r.ticketId ? (
                            <Badge variant="destructive" className="text-[10px]">Chamado #{r.ticketId}</Badge>
                          ) : r.ticketStatus === "failed" ? (
                            <span className="text-destructive">Falha</span>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">Sem chamado</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={failuresOpen} onOpenChange={setFailuresOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Falhas ao abrir chamado
            </DialogTitle>
            <DialogDescription>Tentativas que não conseguiram criar o chamado no GLPI no período.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs text-muted-foreground">
              {failedTicketsList.length} {failedTicketsList.length === 1 ? "falha" : "falhas"}
            </div>
            <Button asChild size="sm" variant="outline">
              <a href={GLPI_DIRECT_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Abrir GLPI
              </a>
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">Usuário</TableHead>
                  <TableHead className="text-xs">Setor</TableHead>
                  <TableHead className="text-xs">Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedTicketsList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                      Nenhuma falha no período.
                    </TableCell>
                  </TableRow>
                ) : failedTicketsList.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(t.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{t.nome || "—"}</div>
                      {t.email && <div className="text-muted-foreground text-[10px]">{t.email}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{t.setor || "—"}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-[260px]">
                      {t.error_message || "Erro não informado"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, onClick, hint }: { icon: any; label: string; value: string | number; onClick?: () => void; hint?: string }) {
  const clickable = !!onClick;
  return (
    <Card
      onClick={onClick}
      className={clickable ? "cursor-pointer transition-colors hover:bg-accent/50 hover:border-primary/40" : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ExportMenu({ data, period }: { data: any; period: Period }) {
  const [busy, setBusy] = useState<string | null>(null);

  function run(name: string, fn: () => void) {
    setBusy(name);
    try { fn(); } catch { toast.error("Falha ao exportar"); } finally { setBusy(null); }
  }

  if (!data) {
    return <Button variant="outline" size="sm" disabled><Download className="w-4 h-4 mr-1.5" />Exportar</Button>;
  }

  const exportEvents = () => run("events", () => {
    const rows = data.events.map((e: any) => ({
      created_at: e.created_at, event_type: e.event_type, category: e.category ?? "",
      setor: e.setor ?? "", org_slug: e.org_slug ?? "", user_id: e.user_id ?? "",
      conversa_id: e.conversa_id ?? "", session_id: e.session_id,
      metadata: e.metadata ? JSON.stringify(e.metadata) : "",
    }));
    const csv = toCsv(rows, [
      { key: "created_at", header: "Data/hora" },
      { key: "event_type", header: "Evento" },
      { key: "category", header: "Categoria" },
      { key: "setor", header: "Setor" },
      { key: "org_slug", header: "Organização" },
      { key: "user_id", header: "User ID" },
      { key: "conversa_id", header: "Conversa ID" },
      { key: "session_id", header: "Session ID" },
      { key: "metadata", header: "Metadata" },
    ]);
    downloadCsv(`chicochat_eventos_${period}_${timestampForFile()}.csv`, csv);
    toast.success(`${rows.length} eventos exportados`);
  });

  const exportTickets = () => run("tickets", () => {
    const rows = data.tickets.map((t: any) => ({
      created_at: t.created_at, status: t.status, glpi_ticket_id: t.glpi_ticket_id ?? "",
      titulo: t.titulo ?? "", categoria: t.categoria ?? "", setor: t.setor ?? "",
      nome: t.nome ?? "", email: t.email ?? "", ip: t.ip ?? "", motivo: t.motivo ?? "",
      error_message: t.error_message ?? "", agent_slug: t.agent_slug ?? "",
      conversa_id: t.conversa_id ?? "", user_id: t.user_id ?? "",
    }));
    const csv = toCsv(rows, [
      { key: "created_at", header: "Data/hora" },
      { key: "status", header: "Status" },
      { key: "glpi_ticket_id", header: "Chamado GLPI" },
      { key: "titulo", header: "Título" },
      { key: "categoria", header: "Categoria" },
      { key: "setor", header: "Setor" },
      { key: "nome", header: "Nome" },
      { key: "email", header: "E-mail" },
      { key: "ip", header: "IP" },
      { key: "motivo", header: "Motivo" },
      { key: "error_message", header: "Erro" },
      { key: "agent_slug", header: "Agente" },
      { key: "conversa_id", header: "Conversa ID" },
      { key: "user_id", header: "User ID" },
    ]);
    downloadCsv(`chicochat_chamados_${period}_${timestampForFile()}.csv`, csv);
    toast.success(`${rows.length} chamados exportados`);
  });

  const exportFeedbacks = () => run("feedbacks", () => {
    const rows = data.feedbacks.map((f: any) => ({
      created_at: f.created_at, rating: f.rating, sugestao: f.sugestao ?? "",
      ticket_id: f.ticket_id ?? "", org_slug: f.org_slug ?? "",
      conversa_id: f.conversa_id ?? "", user_id: f.user_id,
    }));
    const csv = toCsv(rows, [
      { key: "created_at", header: "Data/hora" },
      { key: "rating", header: "Nota" },
      { key: "sugestao", header: "Sugestão" },
      { key: "ticket_id", header: "Chamado" },
      { key: "org_slug", header: "Organização" },
      { key: "conversa_id", header: "Conversa ID" },
      { key: "user_id", header: "User ID" },
    ]);
    downloadCsv(`chicochat_feedbacks_${period}_${timestampForFile()}.csv`, csv);
    toast.success(`${rows.length} avaliações exportadas`);
  });

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={exportEvents} disabled={busy !== null}>
        {busy === "events" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
        Eventos
      </Button>
      <Button variant="outline" size="sm" onClick={exportTickets} disabled={busy !== null}>
        {busy === "tickets" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
        Chamados
      </Button>
      <Button variant="outline" size="sm" onClick={exportFeedbacks} disabled={busy !== null}>
        {busy === "feedbacks" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
        Avaliações
      </Button>
    </div>
  );
}

type InsightItem = {
  tema: string;
  descricao: string;
  estimativa_conversas: number;
  severidade: "baixa" | "media" | "alta";
  exemplos?: string[];
  recomendacao?: string;
};

function AiInsightsCard({ period }: { period: Period }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    summary: string;
    insights: InsightItem[];
    total_conversas: number;
    total_mensagens_usuario: number;
    generated_at: string;
  } | null>(null);

  async function run() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analytics-insights`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ period }),
        },
      );
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Erro ao gerar análise");
      setResult(json);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar análise");
    } finally {
      setLoading(false);
    }
  }

  const sevColor = (s: InsightItem["severidade"]) =>
    s === "alta" ? "destructive" : s === "media" ? "default" : "secondary";

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Análise IA — principais problemas e dúvidas
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            A IA lê as conversas do período selecionado e resume em tópicos os temas mais frequentes, com recomendações para a equipe.
          </p>
        </div>
        <Button size="sm" onClick={run} disabled={loading} variant={result ? "outline" : "default"}>
          {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : result ? <RefreshCw className="w-4 h-4 mr-1.5" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
          {loading ? "Analisando…" : result ? "Atualizar" : "Gerar análise"}
        </Button>
      </CardHeader>
      <CardContent>
        {!result && !loading && (
          <p className="text-sm text-muted-foreground">
            Clique em "Gerar análise" para que a IA inspecione as conversas do período <strong>{period}</strong>.
          </p>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Lendo conversas e gerando síntese…
          </div>
        )}
        {result && (
          <div className="space-y-4">
            <div className="rounded-md bg-background/60 border p-3">
              <p className="text-sm leading-relaxed">{result.summary}</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Baseado em {result.total_conversas} conversas e {result.total_mensagens_usuario} mensagens · gerado em {format(new Date(result.generated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </p>
            </div>

            {result.insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem padrões relevantes identificados.</p>
            ) : (
              <ol className="space-y-3">
                {result.insights.map((it, i) => (
                  <li key={i} className="rounded-md border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}.</span>
                        <h4 className="text-sm font-semibold">{it.tema}</h4>
                        <Badge variant={sevColor(it.severidade) as any} className="text-[10px] capitalize">{it.severidade}</Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums">~{it.estimativa_conversas} conversas</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{it.descricao}</p>
                    {it.exemplos && it.exemplos.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {it.exemplos.slice(0, 3).map((ex, j) => (
                          <li key={j} className="text-[11px] italic text-muted-foreground before:content-['“'] after:content-['”']">{ex}</li>
                        ))}
                      </ul>
                    )}
                    {it.recomendacao && (
                      <p className="mt-2 text-[11px] text-primary/90"><strong>Recomendação:</strong> {it.recomendacao}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
