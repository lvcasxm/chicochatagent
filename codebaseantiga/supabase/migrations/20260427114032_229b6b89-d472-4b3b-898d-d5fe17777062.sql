-- Organizations: admins podem gerenciar todas
CREATE POLICY "Admins manage all orgs"
ON public.organizations
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Categories
CREATE POLICY "Admins manage all categories"
ON public.categories
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Topics
CREATE POLICY "Admins manage all topics"
ON public.topics
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Flows
CREATE POLICY "Admins manage all flows"
ON public.flows
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Flow steps
CREATE POLICY "Admins manage all flow steps"
ON public.flow_steps
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Knowledge base
CREATE POLICY "Admins manage all knowledge"
ON public.knowledge_base
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Support contacts
CREATE POLICY "Admins manage all contacts"
ON public.support_contacts
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));