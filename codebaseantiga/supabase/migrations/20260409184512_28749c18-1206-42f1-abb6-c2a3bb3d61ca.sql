
-- Tabela de conversas
CREATE TABLE public.conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text,
  user_id uuid NOT NULL,
  org_slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON public.conversas FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own conversations"
  ON public.conversas FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.conversas FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.conversas FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_conversas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_conversas_updated_at
  BEFORE UPDATE ON public.conversas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversas_updated_at();

-- Índice para listagem
CREATE INDEX idx_conversas_user_slug ON public.conversas (user_id, org_slug, updated_at DESC);

-- Tabela de mensagens
CREATE TABLE public.mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  conteudo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON public.mensagens FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversas
    WHERE conversas.id = mensagens.conversa_id
    AND conversas.user_id = auth.uid()
  ));

CREATE POLICY "Users can create own messages"
  ON public.mensagens FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversas
    WHERE conversas.id = mensagens.conversa_id
    AND conversas.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own messages"
  ON public.mensagens FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversas
    WHERE conversas.id = mensagens.conversa_id
    AND conversas.user_id = auth.uid()
  ));

CREATE INDEX idx_mensagens_conversa ON public.mensagens (conversa_id, created_at);

-- Habilitar realtime para conversas
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversas;
