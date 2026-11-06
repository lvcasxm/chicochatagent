CREATE TABLE public.ticket_transcripts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  conversa_id uuid,
  user_id uuid,
  glpi_ticket_id text,
  nome text,
  email text,
  setor text,
  titulo text,
  resumo text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_transcripts_conversa ON public.ticket_transcripts (conversa_id);
CREATE INDEX idx_ticket_transcripts_ticket ON public.ticket_transcripts (glpi_ticket_id);

GRANT SELECT ON public.ticket_transcripts TO authenticated;
GRANT ALL ON public.ticket_transcripts TO service_role;

ALTER TABLE public.ticket_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view transcripts"
ON public.ticket_transcripts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));