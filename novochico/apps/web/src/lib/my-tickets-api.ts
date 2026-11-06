import {
  myTicketsResponseSchema,
  transcriptResponseSchema,
  type MyTicketsResponse,
  type TranscriptResponse,
} from '@chicochat/shared';
import { ApiError, call } from './api';

export async function fetchMyTickets(): Promise<MyTicketsResponse> {
  const response = await call('/api/tickets/mine');
  if (!response.ok) throw new ApiError(response.status);
  return myTicketsResponseSchema.parse(await response.json());
}

export async function fetchTranscript(token: string): Promise<TranscriptResponse> {
  const response = await call(`/api/transcripts/${encodeURIComponent(token)}`);
  if (!response.ok) throw new ApiError(response.status);
  return transcriptResponseSchema.parse(await response.json());
}
