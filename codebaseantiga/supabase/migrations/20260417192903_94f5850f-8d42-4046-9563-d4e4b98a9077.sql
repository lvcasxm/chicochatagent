
CREATE TABLE public.tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  agent_slug text,
  conversa_id uuid,
  glpi_ticket_id text,
  status text NOT NULL DEFAULT 'success',
  nome text,
  email text,
  setor text,
  ip text,
  titulo text,
  categoria text,
  motivo text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX idx_tickets_agent_slug ON public.tickets(agent_slug);
CREATE INDEX idx_tickets_setor ON public.tickets(setor);
CREATE INDEX idx_tickets_status ON public.tickets(status);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tickets"
ON public.tickets FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all tickets"
ON public.tickets FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Note: inserts happen from the glpi-ticket edge function using the service role key (bypasses RLS).
-- We intentionally do not create an INSERT policy for end-users.
