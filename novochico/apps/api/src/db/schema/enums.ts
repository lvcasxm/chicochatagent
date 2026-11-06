import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ANALYTICS_EVENT_TYPES,
  CATEGORY_ACTIONS,
  CONVERSATION_OUTCOMES,
  INSTRUCTION_STATUSES,
  MESSAGE_ROLES,
  MESSAGE_SOURCES,
  SUMMARY_SOURCES,
  TICKET_STATUSES,
  USER_ROLES,
} from '@chicochat/shared';

/** Os valores vêm de `@chicochat/shared`, a fonte única usada também pela API e pela web. */
export const userRole = pgEnum('user_role', USER_ROLES);
export const messageRole = pgEnum('message_role', MESSAGE_ROLES);
export const messageSource = pgEnum('message_source', MESSAGE_SOURCES);
export const conversationOutcome = pgEnum('conversation_outcome', CONVERSATION_OUTCOMES);
export const ticketStatus = pgEnum('ticket_status', TICKET_STATUSES);
export const summarySource = pgEnum('summary_source', SUMMARY_SOURCES);
export const categoryAction = pgEnum('category_action', CATEGORY_ACTIONS);
export const instructionStatus = pgEnum('instruction_status', INSTRUCTION_STATUSES);
export const analyticsEventType = pgEnum('analytics_event_type', ANALYTICS_EVENT_TYPES);
