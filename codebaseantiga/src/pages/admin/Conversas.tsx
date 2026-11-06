import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Star, MessageSquare, Search, User, Ticket as TicketIcon, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { periodToFromDate, type Period } from "@/lib/analytics";
import { toCsv, downloadCsv, timestampForFile } from "@/lib/csv-export";
import { toast } from "sonner";

type Conversa = { id: string; user_id: string; org_slug: string | null; titulo: string | null; created_at: string; updated_at: string; session_id: string | null; setor: string | null; };
type Mensagem = { id: string; conversa_id: string; role: string; conteudo: string; created_at: string; };
type TicketRow = { id: string; conversa_id: string | null; glpi_ticket_id: string | null; status: string; setor: string | null; titulo: string | null; created_at: string; nome: string | null; email: string | null; };
type Feedback = { id: string; user_id: string; conversa_id: string | null; rating: number; sugestao: string | null; created_at: string; };
type Profile = { id: string; full_name: string | null };
type SessionRow = { id: string; user_id: string; email: string | null; full_name: string | null; created_at: string };

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "all", label: "Tudo" },
];

export default function Conversas() {
  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");
  const [openConversaId, setOpenConversaId] = useState<string | null>(null);
  const fromDate = useMemo(() => periodToFromDate(period), [period]);
  const fromIso = fromDate?.toISOString() ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-conversas", period],
    queryFn: async () => {
      const PAGE = 1000;
      async function fetchAll<T>(table: string): Promise<T[]> {
        const out: T[] = [];
        let from = 0;
        for (let i = 0; i < 50; i++) {
          let q = supabase.from(table as any).select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1);
          if (fromIso) q = q.gte("created_at", fromIso);
          const { data, error } = await q;
          if (error) throw error;
          const rows = (data ?? []) as T[];
          out.push(...rows);
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        return out;
      }
      const [conversas, tickets, feedbacks, sessions] = await Promise.all([
        fetchAll<Conversa>("conversas"),
        fetchAll<TicketRow>("tickets"),
        fetchAll<Feedback>("feedbacks"),
        fetchAll<SessionRow>("user_sessions"),
      ]);
      // Profiles for nome
      const userIds = Array.from(new Set(conversas.map((c) => c.user_id)));
      let profiles: Profile[] = [];
      if (userIds.length > 0) {
        const { data: pdata } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        profiles = (pdata ?? []) as Profile[];
      }
      return { conversas, tickets, feedbacks, sessions, profiles };
    },
  });

  const userInfoMap = useMemo(() => {
    const m = new Map<string, { name: string; email: string | null }>();
    data?.profiles.forEach((p) => m.set(p.id, { name: p.full_name || "—", email: null }));
    data?.sessions.forEach((s) => {
      const cur = m.get(s.user_id);
      if (!cur) m.set(s.user_id, { name: s.full_name || "—", email: s.email });
      else if (!cur.email && s.email) cur.email = s.email;
    });
    return m;
  }, [data]);

  const ticketByConv = useMemo(() => {
    const m = new Map<string, TicketRow>();
    data?.tickets.forEach((t) => { if (t.conversa_id) m.set(t.conversa_id, t); });
    return m;
  }, [data]);

  const feedbackByConv = useMemo(() => {
    const m = new Map<string, Feedback>();
    data?.feedbacks.forEach((f) => { if (f.conversa_id) m.set(f.conversa_id, f); });
    return m;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.conversas.filter((c) => {
      if (!q) return true;
      const u = userInfoMap.get(c.user_id);
      return (
        c.titulo?.toLowerCase().includes(q) ||
        u?.name.toLowerCase().includes(q) ||
        u?.email?.toLowerCase().includes(q) ||
        c.setor?.toLowerCase().includes(q)
      );
    });
  }, [data, search, userInfoMap]);

  const [exporting, setExporting] = useState<null | "conversas" | "mensagens">(null);

  async function exportConversasCsv() {
    if (!data) return;
    setExporting("conversas");
    try {
      const rows = data.conversas.map((c) => {
        const u = userInfoMap.get(c.user_id);
        const t = ticketByConv.get(c.id);
        const f = feedbackByConv.get(c.id);
        return {
          created_at: c.created_at,
          updated_at: c.updated_at,
          titulo: c.titulo ?? "",
          usuario: u?.name ?? "",
          email: u?.email ?? "",
          setor: c.setor ?? "",
          org_slug: c.org_slug ?? "",
          session_id: c.session_id ?? "",
          conversa_id: c.id,
          user_id: c.user_id,
          ticket_glpi: t?.glpi_ticket_id ?? "",
          ticket_status: t?.status ?? "",
          feedback_rating: f?.rating ?? "",
          feedback_sugestao: f?.sugestao ?? "",
        };
      });
      const csv = toCsv(rows, [
        { key: "created_at", header: "Criada em" },
        { key: "updated_at", header: "Última atividade" },
        { key: "titulo", header: "Título" },
        { key: "usuario", header: "Usuário" },
        { key: "email", header: "E-mail" },
        { key: "setor", header: "Setor" },
        { key: "org_slug", header: "Organização" },
        { key: "session_id", header: "Session ID" },
        { key: "conversa_id", header: "Conversa ID" },
        { key: "user_id", header: "User ID" },
        { key: "ticket_glpi", header: "Chamado GLPI" },
        { key: "ticket_status", header: "Status do chamado" },
        { key: "feedback_rating", header: "Nota" },
        { key: "feedback_sugestao", header: "Sugestão" },
      ]);
      downloadCsv(`chicochat_conversas_${period}_${timestampForFile()}.csv`, csv);
      toast.success(`${rows.length} conversas exportadas`);
    } catch (e) {
      toast.error("Falha ao exportar conversas");
    } finally {
      setExporting(null);
    }
  }

  async function exportMensagensCsv() {
    if (!data) return;
    setExporting("mensagens");
    try {
      const convIds = data.conversas.map((c) => c.id);
      const all: { conversa_id: string; role: string; conteudo: string; created_at: string }[] = [];
      // pagina em chunks de 200 ids
      for (let i = 0; i < convIds.length; i += 200) {
        const chunk = convIds.slice(i, i + 200);
        const { data: msgs, error } = await supabase
          .from("mensagens")
          .select("conversa_id, role, conteudo, created_at")
          .in("conversa_id", chunk)
          .order("created_at", { ascending: true });
        if (error) throw error;
        all.push(...(msgs ?? []));
      }
      const convMeta = new Map(data.conversas.map((c) => [c.id, c]));
      const rows = all.map((m) => {
        const c = convMeta.get(m.conversa_id);
        const u = c ? userInfoMap.get(c.user_id) : undefined;
        return {
          created_at: m.created_at,
          role: m.role,
          conteudo: m.conteudo,
          conversa_titulo: c?.titulo ?? "",
          usuario: u?.name ?? "",
          email: u?.email ?? "",
          setor: c?.setor ?? "",
          conversa_id: m.conversa_id,
        };
      });
      const csv = toCsv(rows, [
        { key: "created_at", header: "Data/hora" },
        { key: "role", header: "Origem" },
        { key: "conteudo", header: "Mensagem" },
        { key: "conversa_titulo", header: "Conversa" },
        { key: "usuario", header: "Usuário" },
        { key: "email", header: "E-mail" },
        { key: "setor", header: "Setor" },
        { key: "conversa_id", header: "Conversa ID" },
      ]);
      downloadCsv(`chicochat_mensagens_${period}_${timestampForFile()}.csv`, csv);
      toast.success(`${rows.length} mensagens exportadas`);
    } catch (e) {
      toast.error("Falha ao exportar mensagens");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-['Space_Grotesk']">Conversas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inspecione todas as conversas, mensagens, chamados e avaliações.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportConversasCsv} disabled={!data || exporting !== null}>
              {exporting === "conversas" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
              Conversas
            </Button>
            <Button variant="outline" size="sm" onClick={exportMensagensCsv} disabled={!data || exporting !== null}>
              {exporting === "mensagens" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}
              Mensagens
            </Button>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              {PERIOD_OPTIONS.map((o) => <TabsTrigger key={o.value} value={o.value}>{o.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar por título, usuário, e-mail ou setor..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{filtered.length} conversas</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Carregando…</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-sm">Sem conversas no período.</div>
          ) : (
            <div className="divide-y">
              {filtered.map((c) => {
                const u = userInfoMap.get(c.user_id);
                const ticket = ticketByConv.get(c.id);
                const fb = feedbackByConv.get(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setOpenConversaId(c.id)}
                    className="w-full text-left py-3 flex items-center gap-4 hover:bg-accent/40 px-2 rounded-md transition-colors"
                  >
                    <div className="flex-shrink-0 text-xs text-muted-foreground w-24">
                      {format(new Date(c.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.titulo || "Sem título"}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <User className="w-3 h-3" />
                        <span>{u?.name || "—"}</span>
                        {u?.email && <span>· {u.email}</span>}
                        {c.setor && <span>· {c.setor}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {fb && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Star className="w-3 h-3" /> {fb.rating}
                        </Badge>
                      )}
                      {ticket?.glpi_ticket_id && (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <TicketIcon className="w-3 h-3" /> #{ticket.glpi_ticket_id}
                        </Badge>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ConversaDialog
        conversaId={openConversaId}
        onClose={() => setOpenConversaId(null)}
        userInfo={openConversaId ? userInfoMap.get(data?.conversas.find((c) => c.id === openConversaId)?.user_id || "") : undefined}
        ticket={openConversaId ? ticketByConv.get(openConversaId) : undefined}
        feedback={openConversaId ? feedbackByConv.get(openConversaId) : undefined}
        conversa={openConversaId ? data?.conversas.find((c) => c.id === openConversaId) : undefined}
      />
    </div>
  );
}

function ConversaDialog({
  conversaId, onClose, userInfo, ticket, feedback, conversa,
}: {
  conversaId: string | null;
  onClose: () => void;
  userInfo?: { name: string; email: string | null };
  ticket?: TicketRow;
  feedback?: Feedback;
  conversa?: Conversa;
}) {
  const { data: mensagens, isLoading } = useQuery({
    queryKey: ["conversa-msgs", conversaId],
    queryFn: async () => {
      if (!conversaId) return [] as Mensagem[];
      const { data, error } = await supabase
        .from("mensagens")
        .select("*")
        .eq("conversa_id", conversaId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Mensagem[];
    },
    enabled: !!conversaId,
  });

  return (
    <Dialog open={!!conversaId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            {conversa?.titulo || "Conversa"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {userInfo?.name || "—"}
            {userInfo?.email && ` · ${userInfo.email}`}
            {conversa?.setor && ` · ${conversa.setor}`}
            {conversa && ` · ${format(new Date(conversa.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}`}
          </DialogDescription>
        </DialogHeader>

        {(ticket || feedback) && (
          <div className="flex flex-wrap gap-2 pb-2 border-b">
            {ticket?.glpi_ticket_id && (
              <Badge variant="destructive" className="gap-1"><TicketIcon className="w-3 h-3" /> Chamado #{ticket.glpi_ticket_id}</Badge>
            )}
            {feedback && (
              <Badge variant="secondary" className="gap-1">
                <Star className="w-3 h-3" /> Nota {feedback.rating}/5
                {feedback.sugestao && ` — "${feedback.sugestao}"`}
              </Badge>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-3">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Carregando…</div>
          ) : !mensagens || mensagens.length === 0 ? (
            <div className="text-muted-foreground text-sm">Sem mensagens.</div>
          ) : (
            <div className="space-y-3 py-2">
              {mensagens.map((m) => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="prose prose-sm max-w-none dark:prose-invert text-[14px]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.conteudo}</ReactMarkdown>
                    </div>
                    <div className="text-[10px] opacity-60 mt-1">
                      {format(new Date(m.created_at), "HH:mm", { locale: ptBR })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
