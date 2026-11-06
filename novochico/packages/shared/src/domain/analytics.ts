/** Eventos gerados pelo servidor (SONNET_CONTEXT, seção B). */
export const ANALYTICS_EVENT_TYPES = [
  'conversation_started',
  'category_detected',
  'resolved_without_ticket',
  'ticket_created',
  'ticket_failed',
  'conversation_finished',
  'rating_received',
  'ticket_duplicate_warning_shown',
  'ticket_duplicate_overridden',
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];
