CREATE TABLE public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  full_name text,
  org_slug text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_created_at ON public.user_sessions (created_at DESC);
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions (user_id);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own sessions"
ON public.user_sessions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own sessions"
ON public.user_sessions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins view all sessions"
ON public.user_sessions FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));