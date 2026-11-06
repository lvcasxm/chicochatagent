import { supabase } from "@/integrations/supabase/client";
import { getSessionId } from "@/lib/session";

export type EventType =
  | "conversation_started"
  | "category_detected"
  | "ticket_created"
  | "resolved_without_ticket"
  | "conversation_finished"
  | "rating_received"
  | "ticket_duplicate_warning_shown"
  | "ticket_duplicate_overridden";

export type TrackEventInput = {
  event_type: EventType;
  user_id: string | null | undefined;
  conversa_id?: string | null;
  org_slug?: string | null;
  category?: string | null;
  setor?: string | null;
  metadata?: Record<string, unknown>;
};

/** Fire-and-forget event tracker. Errors are logged but never thrown. */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  if (!input.user_id) return;
  try {
    const session_id = getSessionId();
    const { error } = await supabase.from("analytics_events").insert({
      session_id,
      conversa_id: input.conversa_id ?? null,
      user_id: input.user_id,
      org_slug: input.org_slug ?? null,
      event_type: input.event_type,
      category: input.category ?? null,
      setor: input.setor ?? null,
      metadata: (input.metadata ?? {}) as any,
    });
    if (error) console.warn("[analytics] insert error:", error.message);
  } catch (e) {
    console.warn("[analytics] track failed:", e);
  }
}
