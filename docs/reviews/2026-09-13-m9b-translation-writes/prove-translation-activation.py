"""Real rollback SQL activation faults, including independent legacy constraint fixtures."""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
source=app/'supabase/migrations/20261014000017_engagement_translation_command_activation.sql';original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-activation-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
cases=[('baseline',original,None,None),('harmless',original+'\n-- Harmless activation control.\n',None,None)]
def mutate(name,old,new,expected,fixture=None):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new),expected,fixture))
for privilege,label in [('INSERT','direct insert'),('UPDATE','direct update'),('DELETE','direct delete'),('TRUNCATE','Activation privilege remains: TRUNCATE'),('REFERENCES','Activation privilege remains: REFERENCES'),('TRIGGER','Activation privilege remains: TRIGGER')]:
 old='REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';new='REVOKE '+', '.join(p for p in ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] if p!=privilege)
 mutate('allow-'+privilege.lower(),old,new,label)
mutate('omit-staff-grant','GRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;','-- Grant omitted.','Activated staff command failed')
mutate('retain-anonymous-execute','FROM PUBLIC, anon;','FROM PUBLIC;','Anonymous command grant remains')
mutate('retain-public-execute','FROM PUBLIC, anon;','FROM anon;','Anonymous command grant remains')
mutate('retain-public-table-grants','FROM PUBLIC, anon, authenticated;','FROM anon, authenticated;','direct insert')
mutate('retain-anonymous-table-grants','FROM PUBLIC, anon, authenticated;','FROM PUBLIC, authenticated;','Activation privilege remains: INSERT')
cases.append(('disable-history-capture',original+'\nALTER TABLE public.engagement_content_translations DISABLE TRIGGER engagement_translation_history_capture;\n','Original translation history missing','translation-history.sql'))
cases.append(('disable-history-receipt-link',original+'\nALTER TABLE public.engagement_translation_history DISABLE TRIGGER translation_history_receipt;\n','History did not return one complete batch receipt','translation-history-receipts.sql'))
cases.append(('disable-category-reference',original+"""
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid='public.engagement_content_translations'::regclass
 AND tgconstraint IN (SELECT oid FROM pg_constraint WHERE conname='engagement_translation_category_target') LOOP
  EXECUTE format('ALTER TABLE public.engagement_content_translations DISABLE TRIGGER %I',t.tgname);
 END LOOP;
END $$;
""",'Foreign category target expected','translation-scope.sql'))
for name,policy,expected in [
 ('deny-staff-receipt', 'false', 'Staff cannot read exact command receipt'),
 ('leak-viewer-receipt', "EXISTS(SELECT 1 FROM workspace_members m WHERE m.user_id=auth.uid())", 'Nonstaff read command receipts: viewer'),
 ('leak-outsider-receipt', "NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.user_id=auth.uid() AND m.role='viewer')", 'Nonstaff read command receipts: outsider'),
]:
 cases.append((name,original+'\nALTER POLICY translation_receipts_staff_read ON public.engagement_translation_write_receipts USING ('+policy+');\n',expected,'translation-command-activation.sql'))
cases.append(('allow-anonymous-receipt-select',original+'\nGRANT SELECT ON public.engagement_translation_write_receipts TO anon;\n','anonymous receipt read','translation-command-activation.sql'))
results=[]
try:
 for name,body,expected,fixture in cases:
  assert source.read_text()==original;source.write_text(body)
  command=['python3',str(review/'run-translation-activation-probe.py')]+([fixture] if fixture else [])
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=120)
  finally:source.write_text(original)
  output=run.stdout+run.stderr;(private/(name+'.log')).write_text(output)
  correct=run.returncode==0 and '"rollbackContained": true' in output if expected is None else run.returncode!=0 and expected in output and 'escaped rollback' not in output
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'expectedOutcome':correct})
  (review/'translation-activation-controls.json').write_text(json.dumps({'migrationSha256':hashlib.sha256(original.encode()).hexdigest(),'runnerSha256':hashlib.sha256((review/'run-translation-activation-probe.py').read_bytes()).hexdigest(),'fixtureSha256':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in (app/'src/test/fixtures/engagement').glob('translation-*.sql')},'privateEvidence':str(private),'results':results,'limits':'Real SQL on named disposable stack, all migrations/grants/rows/triggers rolled back. Permission probes exercise insert/update/delete but inspect truncate/references/trigger privileges without executing those operations. Native constraint/history fixtures deliberately use privileged legacy writes; current staff access uses a separate command fixture. Does not prove browser navigation, worker execution, permanent migration install or public comment generation.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,output[-2000:])
finally:assert source.read_text()==original
