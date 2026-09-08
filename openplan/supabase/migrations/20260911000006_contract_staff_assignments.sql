CREATE TABLE public.contract_task_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES public.contract_tasks(id), engagement_id uuid NOT NULL REFERENCES public.invoicing_engagements(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 staff_id uuid NOT NULL REFERENCES public.invoicing_staff(id),assignee_user_id uuid REFERENCES auth.users(id), active boolean NOT NULL, UNIQUE(task_id,staff_id)
);
ALTER TABLE public.contract_task_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_task_assignments FROM anon,authenticated,service_role;
GRANT SELECT ON public.contract_task_assignments TO authenticated,service_role;
CREATE POLICY workspace_assignment_read ON public.contract_task_assignments FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=contract_task_assignments.workspace_id AND m.user_id=auth.uid()));
CREATE FUNCTION public.assign_approved_contract_tasks() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE task jsonb; person jsonb;
BEGIN
 IF NEW.state<>'approved' THEN RETURN NEW; END IF;
 UPDATE public.contract_task_assignments SET active=false WHERE engagement_id=NEW.engagement_id;
 FOR task IN SELECT value FROM jsonb_array_elements(NEW.content->'tasks') LOOP
  FOR person IN SELECT value FROM jsonb_array_elements(task->'staff') LOOP
   INSERT INTO public.contract_task_assignments(task_id,engagement_id,workspace_id,staff_id,assignee_user_id,active)
   SELECT (task->>'id')::uuid,NEW.engagement_id,NEW.workspace_id,s.id,s.user_id,true FROM public.invoicing_staff s WHERE s.id=(person->>'staffId')::uuid AND s.workspace_id=NEW.workspace_id
   ON CONFLICT(task_id,staff_id) DO UPDATE SET active=true,assignee_user_id=excluded.assignee_user_id;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER approved_contract_assignments AFTER UPDATE ON public.contract_baselines FOR EACH ROW EXECUTE FUNCTION public.assign_approved_contract_tasks();
