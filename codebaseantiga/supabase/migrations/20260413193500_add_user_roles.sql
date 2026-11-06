-- Adiciona coluna role na tabela profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin', 'user'));

-- Atualiza a função handle_new_user para garantir role = 'user' por padrão
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Promove os administradores oficiais
UPDATE public.profiles
SET role = 'admin'
WHERE id IN (
  SELECT id FROM auth.users
  WHERE email IN (
    'lucas.pinheiro@pedroleopoldo.mg.gov.br',
    'lorrayne.silva@pedroleopoldo.mg.gov.br'
  )
);

-- Policy: somente o próprio usuário pode ver seu role
-- (as policies de select já existem, mas garantimos que role não seja editável por users comuns)
-- Apenas admins podem atualizar o role de outros usuários (via service_role ou migration)
