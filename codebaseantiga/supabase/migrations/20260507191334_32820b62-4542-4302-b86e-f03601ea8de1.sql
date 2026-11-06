
-- 1. Add session_id and setor to conversas
ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS setor text;

CREATE INDEX IF NOT EXISTS idx_conversas_session_id ON public.conversas(session_id);
CREATE INDEX IF NOT EXISTS idx_conversas_user_created ON public.conversas(user_id, created_at);

-- 2. Backfill session_id for existing conversations using 30-min inactivity window
WITH ordered AS (
  SELECT id, user_id, created_at,
    LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev_at
  FROM public.conversas
), flagged AS (
  SELECT id, user_id, created_at,
    CASE WHEN prev_at IS NULL OR (created_at - prev_at) > interval '30 minutes' THEN 1 ELSE 0 END AS new_session
  FROM ordered
), grouped AS (
  SELECT id, user_id,
    SUM(new_session) OVER (PARTITION BY user_id ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sess_num
  FROM flagged
), sess_uuids AS (
  SELECT DISTINCT user_id, sess_num, gen_random_uuid() AS sid FROM grouped
)
UPDATE public.conversas c
SET session_id = s.sid
FROM grouped g
JOIN sess_uuids s ON s.user_id = g.user_id AND s.sess_num = g.sess_num
WHERE c.id = g.id AND c.session_id IS NULL;

-- 3. Backfill setor on conversas using last ticket setor
UPDATE public.conversas c
SET setor = t.setor
FROM public.tickets t
WHERE t.conversa_id = c.id AND t.setor IS NOT NULL AND c.setor IS NULL;

-- 4. analytics_events table
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  conversa_id uuid,
  user_id uuid,
  org_slug text,
  event_type text NOT NULL,
  category text,
  setor text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ae_session ON public.analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_ae_conversa ON public.analytics_events(conversa_id);
CREATE INDEX IF NOT EXISTS idx_ae_user ON public.analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ae_type_created ON public.analytics_events(event_type, created_at);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own events" ON public.analytics_events;
CREATE POLICY "Users insert own events"
  ON public.analytics_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own events" ON public.analytics_events;
CREATE POLICY "Users view own events"
  ON public.analytics_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all events" ON public.analytics_events;
CREATE POLICY "Admins view all events"
  ON public.analytics_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
