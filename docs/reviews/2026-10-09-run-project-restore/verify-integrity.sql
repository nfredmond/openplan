DO $proof$
DECLARE w uuid; m uuid; u uuid; other uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 r uuid:=gen_random_uuid(); mr uuid:=gen_random_uuid(); cr uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
 t text; row_id uuid; constraint_name text;
BEGIN
 SELECT workspace_id,model_id,created_by INTO STRICT w,m,u FROM public.model_runs WHERE created_by IS NOT NULL LIMIT 1;
 INSERT INTO public.workspaces(id,name,slug) VALUES(other,'Synthetic foreign workspace','restore-'||other);
 INSERT INTO public.projects(id,workspace_id,name) VALUES(p,w,'Synthetic project restore integrity');
 INSERT INTO public.runs(id,workspace_id,project_id,query_text) VALUES(r,w,p,'Synthetic integrity only');
 INSERT INTO public.model_runs(id,workspace_id,model_id,project_id,run_title) VALUES(mr,w,m,p,'Synthetic integrity only');
 INSERT INTO public.county_runs(id,workspace_id,project_id,geography_id,run_name) VALUES(cr,w,p,'synthetic-unassessed','restore-'||cr);
 INSERT INTO public.stage_gate_decisions(id,workspace_id,project_id,gate_id,decision,rationale,decided_by) VALUES(d,w,p,'synthetic','HOLD','Synthetic integrity only',u);
 FOR t,row_id IN SELECT * FROM (VALUES('runs',r),('model_runs',mr),('county_runs',cr),('stage_gate_decisions',d)) v LOOP
  BEGIN
   EXECUTE format('UPDATE public.%I SET workspace_id=$1 WHERE id=$2',t) USING other,row_id;
   RAISE EXCEPTION 'foreign workspace accepted: %',t;
  EXCEPTION WHEN foreign_key_violation THEN
   GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
   IF constraint_name<>t||'_project_workspace_fk' THEN RAISE; END IF;
  END;
 END LOOP;
 BEGIN
  UPDATE public.projects SET workspace_id=other WHERE id=p;
  RAISE EXCEPTION 'parent workspace changed beneath children';
 EXCEPTION WHEN foreign_key_violation THEN
  GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
  IF constraint_name NOT IN ('runs_project_workspace_fk','model_runs_project_workspace_fk','county_runs_project_workspace_fk','stage_gate_decisions_project_workspace_fk') THEN RAISE; END IF;
 END;
 -- Preserve the existing deletion distinction: runs survive unattributed;
 -- project gate decisions follow their existing database cascade behavior.
 DELETE FROM public.projects WHERE id=p;
 IF NOT EXISTS(SELECT 1 FROM public.runs WHERE id=r AND workspace_id=w AND project_id IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.model_runs WHERE id=mr AND workspace_id=w AND project_id IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.county_runs WHERE id=cr AND workspace_id=w AND project_id IS NULL)
 OR EXISTS(SELECT 1 FROM public.stage_gate_decisions WHERE id=d) THEN
  RAISE EXCEPTION 'project deletion semantics changed';
 END IF;
END $proof$;
