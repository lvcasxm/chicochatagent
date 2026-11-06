import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageSquareText, ShieldAlert, User, Bot } from "lucide-react";

type TranscriptMsg = { role: "user" | "assistant"; content: string };

type Transcript = {
  ticket_id: string | null;
  nome: string | null;
  setor: string | null;
  titulo: string | null;
  resumo: string | null;
  created_at: string;
  messages: TranscriptMsg[];
};

const TRANSCRIPT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conversa-transcript`;

export default function ConversationTranscript() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Conversa completa — ChicoChat+";
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(TRANSCRIPT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ token }),
        });
        const payload = await resp.json().catch(() => ({}));
        if (!active) return;
        if (!resp.ok) setError(payload.error || "Não foi possível carregar a conversa.");
        else setData(payload as Transcript);
      } catch {
        if (active) setError("Erro de conexão. Tente novamente.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-start gap-3">
          <MessageSquareText className="mt-1 h-6 w-6 text-primary" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conversa completa</h1>
            <p className="text-sm text-muted-foreground">
              Histórico integral do atendimento no ChicoChat+ que originou o chamado.
            </p>
          </div>
        </header>

        {loading && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando conversa...
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
            <div>
              <p className="font-medium text-foreground">{error}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Este conteúdo só pode ser acessado pelo link exclusivo disponibilizado no chamado.
              </p>
            </div>
          </div>
        )}

        {!loading && data && (
          <>
            <section className="mb-6 rounded-lg border border-border bg-card p-5">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {data.ticket_id && (
                  <div>
                    <dt className="text-muted-foreground">Chamado GLPI</dt>
                    <dd className="font-medium text-foreground">#{data.ticket_id}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Solicitante</dt>
                  <dd className="font-medium text-foreground">{data.nome || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Setor</dt>
                  <dd className="font-medium text-foreground">{data.setor || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Abertura</dt>
                  <dd className="font-medium text-foreground">
                    {new Date(data.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </dd>
                </div>
              </dl>
              {data.titulo && (
                <p className="mt-4 border-t border-border pt-4 text-base font-semibold text-foreground">
                  {data.titulo}
                </p>
              )}
              {data.resumo && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    Ver resumo gerado pela IA
                  </summary>
                  <div className="prose prose-sm mt-2 max-w-none text-muted-foreground dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.resumo}</ReactMarkdown>
                  </div>
                </details>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Histórico da conversa ({data.messages.length} mensagens)
              </h2>
              {data.messages.map((m, i) => (
                <article
                  key={i}
                  className={`rounded-lg border p-4 ${
                    m.role === "user" ? "border-primary/30 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {m.role === "user" ? (
                      <User className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Bot className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {m.role === "user" ? "Cidadão / Servidor" : "ChicoChat+"}
                  </div>
                  <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                </article>
              ))}
              {data.messages.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada nesta conversa.</p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
