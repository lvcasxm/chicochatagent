
CREATE TABLE public.ai_response_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_hash TEXT NOT NULL,
  org_id UUID NOT NULL,
  category TEXT,
  response TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_hit_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (org_id, prompt_hash)
);

CREATE INDEX idx_ai_response_cache_lookup ON public.ai_response_cache (org_id, prompt_hash);
CREATE INDEX idx_ai_response_cache_created ON public.ai_response_cache (created_at);

GRANT ALL ON public.ai_response_cache TO service_role;

ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view cache"
ON public.ai_response_cache
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
