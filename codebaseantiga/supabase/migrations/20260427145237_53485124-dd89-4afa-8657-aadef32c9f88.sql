INSERT INTO public.user_roles (user_id, role)
VALUES 
  ('74be15bb-69ca-4564-82a5-6901aa2764ec', 'admin'),
  ('f25f8e7f-b89d-44b9-b4d3-c2c1a30260d7', 'admin')
ON CONFLICT DO NOTHING;