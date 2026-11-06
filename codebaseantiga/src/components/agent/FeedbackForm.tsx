import { useState } from "react";
import { Star, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics-events";

type Props = {
  userId: string;
  orgSlug?: string | null;
  conversaId?: string | null;
  ticketId?: string | number | null;
  onClose: () => void;
};

export default function FeedbackForm({ userId, orgSlug, conversaId, ticketId, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [sugestao, setSugestao] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating < 1) {
      toast.error("Selecione uma nota de 1 a 5 estrelas.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("feedbacks").insert({
      user_id: userId,
      org_slug: orgSlug ?? null,
      conversa_id: conversaId ?? null,
      rating,
      sugestao: sugestao.trim() ? sugestao.trim().slice(0, 1000) : null,
      ticket_id: ticketId ? String(ticketId) : null,
    });
    setSubmitting(false);
    if (error) {
      console.error("Feedback insert error:", error);
      toast.error("Não foi possível enviar sua avaliação. Tente novamente.");
      return;
    }
    trackEvent({
      event_type: "rating_received",
      user_id: userId,
      conversa_id: conversaId ?? null,
      org_slug: orgSlug ?? null,
      metadata: { rating, ticket_id: ticketId ? String(ticketId) : null, has_comment: !!sugestao.trim() },
    });
    toast.success("Obrigado pelo feedback!");
    onClose();
  };

  return (
    <div className="w-full">
      <div className="mb-5 text-center">
        <h3 className="text-xl font-bold leading-tight mb-1">Como foi sua experiência?</h3>
        <p className="text-sm opacity-70">Sua avaliação ajuda a melhorar o ChicoChat+.</p>
      </div>

      <div className="flex justify-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hoverRating || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(0)}
              className="transition-transform active:scale-90 hover:scale-110"
              aria-label={`Avaliar ${n} estrela${n > 1 ? "s" : ""}`}
            >
              <Star
                className="w-9 h-9"
                style={{
                  color: active ? "hsl(var(--bot-primary))" : "hsl(var(--bot-border))",
                  fill: active ? "hsl(var(--bot-primary))" : "transparent",
                }}
              />
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5 mb-5">
        <label className="text-xs font-semibold uppercase tracking-wider opacity-60 ml-1">
          Sugestão (opcional)
        </label>
        <textarea
          value={sugestao}
          onChange={(e) => setSugestao(e.target.value.slice(0, 1000))}
          placeholder="Quer deixar uma sugestão para melhorarmos?"
          rows={3}
          className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all resize-none"
          style={{
            background: "hsl(var(--bot-bg))",
            border: "1px solid hsl(var(--bot-border))",
            ["--tw-ring-color" as any]: "hsl(var(--bot-primary))",
          }}
        />
        <div className="text-[10px] opacity-50 text-right">{sugestao.length}/1000</div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95 border disabled:opacity-50"
          style={{
            background: "transparent",
            borderColor: "hsl(var(--bot-border))",
            color: "hsl(var(--bot-fg))",
          }}
        >
          Pular
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || rating < 1}
          className={`flex-[2] py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg ${
            rating >= 1 && !submitting ? "hover:brightness-110" : "opacity-40 cursor-not-allowed"
          }`}
          style={{
            background: "hsl(var(--bot-primary))",
            color: "hsl(var(--bot-primary-fg))",
          }}
        >
          {submitting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <Send className="w-4 h-4" />
              Enviar avaliação
            </>
          )}
        </button>
      </div>
    </div>
  );
}
