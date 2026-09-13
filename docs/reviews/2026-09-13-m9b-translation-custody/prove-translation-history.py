from pathlib import Path
import os,subprocess,json
source_dir=Path(__file__).resolve().parent
root=Path(os.environ["OPENPLAN_TRANSLATION_PROBE_EVIDENCE"]).resolve()
if root.is_relative_to(source_dir.parents[2]):
 raise ValueError("Evidence must be outside the repository")
root.mkdir(parents=True,exist_ok=True)
candidate=(source_dir/'translation-history-candidate.sql').read_text()
probe=(source_dir/'translation-history-probe.sql').read_text()
base=['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1']
no_op="IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;"
immutable="CREATE TRIGGER engagement_translation_history_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_history\n FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();"
cases=[('baseline',candidate,None),('harmless-comment','-- Harmless control.\n'+candidate,None),
 ('lose-model',candidate.replace("auth.uid(),'created',to_jsonb(NEW)","auth.uid(),'created',(to_jsonb(NEW)-'machine_model')"),'Original model, words, actor or hash lost'),
 ('foreign-reader',candidate[:candidate.index(' FOR SELECT TO authenticated USING')]+' FOR SELECT TO authenticated USING (true);\n'+candidate[candidate.index('CREATE TRIGGER engagement_translation_history_immutable'):],'Foreign actor read history'),
 ('mutable-history',candidate.replace(immutable,''),'Retained history tampering survived'),
 ('record-noop',candidate.replace(no_op,''),'Wrong translation sequence'),
 ('truncate-reader',candidate.replace('FROM public.engagement_translation_history h WHERE h.campaign_id=p_campaign', 'FROM (SELECT * FROM public.engagement_translation_history WHERE campaign_id=p_campaign ORDER BY translation_id,revision LIMIT 1000) h WHERE h.campaign_id=p_campaign'),'Staff history incomplete')]
results=[]
for name,source,expected in cases:
 sql="BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';\n"+(source_dir/'translation-history-legacy-fixture.sql').read_text()+source+probe+'\nROLLBACK;\n'
 r=subprocess.run(base,input=sql,text=True,capture_output=True)
 (root/f'translation-history-{name}.log').write_text(r.stdout+r.stderr)
 absent=subprocess.run(base+['-At'],input="SELECT to_regclass('public.engagement_translation_history') IS NULL;",text=True,capture_output=True,check=True).stdout.strip()=='t'
 matched=(r.returncode==0 if expected is None else r.returncode!=0 and expected in r.stderr)
 item={'case':name,'exit_code':r.returncode,'expected_failure':expected,'matched':matched,'prototype_schema_rolled_back':absent}
 results.append(item)
 assert matched and absent,item
(root/'translation-history-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
