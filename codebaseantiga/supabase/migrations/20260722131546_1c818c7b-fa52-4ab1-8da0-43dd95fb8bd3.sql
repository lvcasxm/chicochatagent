
DROP POLICY IF EXISTS "Public view categories" ON public.categories;
CREATE POLICY "Authenticated view categories" ON public.categories FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.categories FROM anon;

DROP POLICY IF EXISTS "Anyone can view orgs" ON public.organizations;
CREATE POLICY "Authenticated view orgs" ON public.organizations FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.organizations FROM anon;

DROP POLICY IF EXISTS "Anyone read knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Auth users delete knowledge files" ON storage.objects;

CREATE POLICY "Org members read knowledge files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'knowledge-files'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id::text = (storage.foldername(name))[1]
        AND o.created_by = auth.uid()
    )
  )
);

CREATE POLICY "Org owners upload knowledge files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'knowledge-files'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id::text = (storage.foldername(name))[1]
        AND o.created_by = auth.uid()
    )
  )
);

CREATE POLICY "Org owners update knowledge files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'knowledge-files'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id::text = (storage.foldername(name))[1]
        AND o.created_by = auth.uid()
    )
  )
);

CREATE POLICY "Org owners delete knowledge files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'knowledge-files'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id::text = (storage.foldername(name))[1]
        AND o.created_by = auth.uid()
    )
  )
);

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
