import { AlertTriangle, ExternalLink, Send, Loader2, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export type DuplicateCandidate = {
  glpi_ticket_id: string | null;
  titulo: string | null;
  categoria: string | null;
  setor: string | null;
  created_at: string;
  opened_label: string;
  url: string | null;
  score: number;
};

export type CollectiveIncident = {
  count: number;
  categoria: string | null;
  since_label: string;
  sample_titles: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  duplicates: DuplicateCandidate[];
  collectiveIncident: CollectiveIncident | null;
  onProceed: () => void;
  isSubmitting?: boolean;
};

export default function DuplicateTicketDialog({
  open,
  onOpenChange,
  duplicates,
  collectiveIncident,
  onProceed,
  isSubmitting,
}: Props) {
  const hasDuplicates = duplicates.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg border p-0 overflow-hidden"
        style={{
          background: "hsl(var(--bot-card))",
          borderColor: "hsl(var(--bot-border))",
          color: "hsl(var(--bot-fg))",
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Possível chamado duplicado</DialogTitle>
          <DialogDescription>
            Encontramos um chamado semelhante recente. Confirme se deseja abrir mesmo assim.
          </DialogDescription>
        </DialogHeader>

        {/* Header */}
        <div
          className="px-6 pt-6 pb-4 flex items-start gap-3"
          style={{
            borderBottom: "1px solid hsl(var(--bot-border))",
            background:
              "linear-gradient(180deg, hsl(var(--bot-primary) / 0.08), transparent)",
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "hsl(var(--bot-primary) / 0.14)",
              color: "hsl(var(--bot-primary))",
            }}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-base font-bold leading-tight">
                Encontramos um chamado parecido
              </h3>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{
                  background: "hsl(var(--bot-primary) / 0.14)",
                  color: "hsl(var(--bot-primary))",
                }}
              >
                Possível duplicado
              </span>
            </div>
            <p className="text-xs leading-snug opacity-70">
              Para acelerar seu atendimento e evitar filas duplicadas, confira se já
              existe um chamado em andamento para esse mesmo problema.
            </p>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="px-6 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
          {collectiveIncident && (
            <div
              className="rounded-xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-1"
              style={{
                background: "hsl(var(--bot-primary) / 0.08)",
                border: "1px dashed hsl(var(--bot-primary) / 0.4)",
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: "hsl(var(--bot-primary) / 0.16)",
                  color: "hsl(var(--bot-primary))",
                }}
              >
                <Users className="w-4 h-4" />
              </div>
              <div className="text-xs leading-snug">
                <p className="font-semibold mb-0.5">
                  Já identificamos {collectiveIncident.count} relatos semelhantes nas{" "}
                  {collectiveIncident.since_label}.
                </p>
                <p className="opacity-70">
                  A equipe técnica já foi notificada e está atuando neste incidente.
                  Você pode aguardar ou abrir mesmo assim para registrar seu caso.
                </p>
              </div>
            </div>
          )}

          {hasDuplicates ? (
            duplicates.map((d, i) => (
              <div
                key={`${d.glpi_ticket_id ?? "noid"}-${i}`}
                className="rounded-xl p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-1"
                style={{
                  background: "hsl(var(--bot-bg))",
                  border: "1px solid hsl(var(--bot-border))",
                }}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {d.glpi_ticket_id && (
                        <span
                          className="text-[11px] font-mono font-bold"
                          style={{ color: "hsl(var(--bot-primary))" }}
                        >
                          #{d.glpi_ticket_id}
                        </span>
                      )}
                      <span className="text-[10px] opacity-60">{d.opened_label}</span>
                    </div>
                    <p className="text-sm font-semibold leading-snug line-clamp-2">
                      {d.titulo || "Chamado sem título"}
                    </p>
                  </div>
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: "hsl(var(--bot-muted))",
                      color: "hsl(var(--bot-muted-fg))",
                    }}
                  >
                    {Math.round(d.score * 100)}% similar
                  </span>
                </div>
                {d.categoria && (
                  <p className="text-[11px] opacity-60 mb-2">{d.categoria}</p>
                )}
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                    style={{ color: "hsl(var(--bot-primary))" }}
                  >
                    Ver chamado existente <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-[11px] opacity-50">
                    Acompanhe pelo portal de suporte
                  </span>
                )}
              </div>
            ))
          ) : (
            !collectiveIncident && (
              <p className="text-sm opacity-60 text-center py-6">
                Nenhum chamado semelhante encontrado.
              </p>
            )
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3"
          style={{ borderTop: "1px solid hsl(var(--bot-border))" }}
        >
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 border disabled:opacity-50"
            style={{
              background: "transparent",
              borderColor: "hsl(var(--bot-border))",
              color: "hsl(var(--bot-fg))",
            }}
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onProceed}
            disabled={isSubmitting}
            className="flex-[2] py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg hover:brightness-110 disabled:opacity-60"
            style={{
              background: "hsl(var(--bot-primary))",
              color: "hsl(var(--bot-primary-fg))",
            }}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Abrir mesmo assim
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
