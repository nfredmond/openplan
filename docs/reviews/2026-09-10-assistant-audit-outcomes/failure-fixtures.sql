-- Only synthetic projects in the explicitly owned disposable acceptance workspace.
CREATE FUNCTION public.codex_audit_decision_refusal_20260910() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id = 'e5d07b22-4ee6-41dc-828f-0dbfc93383f1' AND
 NEW.project_id IN ('87b2e543-d5bd-4fe9-96e4-c212472bdd17','fc91e076-dfc5-4c3a-a937-c55b8445e9ac') THEN
  RAISE EXCEPTION 'Synthetic decision refusal' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER codex_audit_decision_refusal_20260910 BEFORE INSERT ON public.stage_gate_decisions FOR EACH ROW EXECUTE FUNCTION public.codex_audit_decision_refusal_20260910();
CREATE FUNCTION public.codex_audit_ledger_refusal_20260910() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id = 'e5d07b22-4ee6-41dc-828f-0dbfc93383f1' AND
 NEW.input_summary->>'projectId' IN ('332062cf-cba1-425d-af4b-bb1b2a2324b3','b6d50c4b-d9b0-45ad-a294-3ed8c83fe5e7') THEN
  RAISE EXCEPTION 'Synthetic audit persistence refusal' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER codex_audit_ledger_refusal_20260910 BEFORE INSERT ON public.assistant_action_executions FOR EACH ROW EXECUTE FUNCTION public.codex_audit_ledger_refusal_20260910();
