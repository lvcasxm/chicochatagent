import { z } from 'zod';
import { USER_ROLES } from '../domain/roles';

/** GET /api/me: o usuário logado e se ele já aceitou a versão atual do aviso de privacidade. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(USER_ROLES),
  defaultSector: z.string().nullable(),
  privacyAccepted: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** POST /api/me/privacy-ack: a versão do aviso que o usuário viu e aceitou. */
export const privacyAckRequestSchema = z.object({
  version: z.string().min(1).max(40),
});
export type PrivacyAckRequest = z.infer<typeof privacyAckRequestSchema>;
