
-- Add content_version to organizations for real-time cache invalidation
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS content_version BIGINT NOT NULL DEFAULT 0;

-- Trigger function: bump organization's content_version whenever
-- categories/topics/flows/flow_steps/knowledge_base change.
CREATE OR REPLACE FUNCTION public.bump_org_content_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'flow_steps' THEN
    -- flow_steps has no organization_id; derive from parent flow
    SELECT f.organization_id INTO v_org_id
    FROM public.flows f
    WHERE f.id = COALESCE(NEW.flow_id, OLD.flow_id);
  ELSE
    v_org_id := COALESCE(NEW.organization_id, OLD.organization_id);
  END IF;

  IF v_org_id IS NOT NULL THEN
    UPDATE public.organizations
    SET content_version = content_version + 1
    WHERE id = v_org_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_bump_org_version_categories ON public.categories;
CREATE TRIGGER trg_bump_org_version_categories
AFTER INSERT OR UPDATE OR DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.bump_org_content_version();

DROP TRIGGER IF EXISTS trg_bump_org_version_topics ON public.topics;
CREATE TRIGGER trg_bump_org_version_topics
AFTER INSERT OR UPDATE OR DELETE ON public.topics
FOR EACH ROW EXECUTE FUNCTION public.bump_org_content_version();

DROP TRIGGER IF EXISTS trg_bump_org_version_flows ON public.flows;
CREATE TRIGGER trg_bump_org_version_flows
AFTER INSERT OR UPDATE OR DELETE ON public.flows
FOR EACH ROW EXECUTE FUNCTION public.bump_org_content_version();

DROP TRIGGER IF EXISTS trg_bump_org_version_flow_steps ON public.flow_steps;
CREATE TRIGGER trg_bump_org_version_flow_steps
AFTER INSERT OR UPDATE OR DELETE ON public.flow_steps
FOR EACH ROW EXECUTE FUNCTION public.bump_org_content_version();

DROP TRIGGER IF EXISTS trg_bump_org_version_knowledge_base ON public.knowledge_base;
CREATE TRIGGER trg_bump_org_version_knowledge_base
AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_base
FOR EACH ROW EXECUTE FUNCTION public.bump_org_content_version();
