import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onAccept: () => void;
};

export default function PrivacyNoticeDialog({ open, onAccept }: Props) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg border [&>button]:hidden"
        style={{ background: "hsl(var(--bot-card))", borderColor: "hsl(var(--bot-border))" }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" style={{ color: "hsl(var(--bot-primary))" }} />
          <DialogTitle style={{ color: "hsl(var(--bot-fg))" }}>
            Aviso de Privacidade e Segurança
          </DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          Termos de uso sobre privacidade e segurança ao utilizar o ChicoChat+.
        </DialogDescription>

        <div
          className="space-y-3 text-sm leading-relaxed"
          style={{ color: "hsl(var(--bot-fg))" }}
        >
          <p>Ao utilizar este assistente, você concorda que:</p>

          <div
            className="rounded-lg border p-3"
            style={{
              borderColor: "hsl(var(--bot-primary) / 0.4)",
              background: "hsl(var(--bot-primary) / 0.08)",
            }}
          >
            <p className="font-semibold mb-1" style={{ color: "hsl(var(--bot-primary))" }}>
              ⚠️ NÃO DIGITE DADOS SENSÍVEIS
            </p>
            <p className="text-sm" style={{ color: "hsl(var(--bot-fg))" }}>
              É estritamente proibido informar <strong>senhas</strong>,{" "}
              <strong>dados de cidadãos</strong>,{" "}
              <strong>números de processos sigilosos</strong> ou outras informações sensíveis no
              chat. Forneça apenas as informações solicitadas.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onAccept}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              background: "hsl(var(--bot-primary))",
              color: "hsl(var(--bot-primary-fg))",
            }}
          >
            Li e concordo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
