
CREATE TABLE public.feedbacks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  org_slug text,
  conversa_id uuid,
  rating integer NOT NULL,
  sugestao text,
  ticket_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- Validation trigger (avoid CHECK on mutable expressions; keep rules centralized)
CREATE OR REPLACE FUNCTION public.validate_feedback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.rating IS NULL OR NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'rating must be between 1 and 5';
  END IF;
  IF NEW.sugestao IS NOT NULL AND length(NEW.sugestao) > 1000 THEN
    RAISE EXCEPTION 'sugestao must be at most 1000 characters';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedbacks_validate
BEFORE INSERT OR UPDATE ON public.feedbacks
FOR EACH ROW EXECUTE FUNCTION public.validate_feedback();

-- RLS policies
CREATE POLICY "Users can insert own feedback"
ON public.feedbacks FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own feedback"
ON public.feedbacks FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all feedback"
ON public.feedbacks FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_feedbacks_user ON public.feedbacks(user_id);
CREATE INDEX idx_feedbacks_conversa ON public.feedbacks(conversa_id);
