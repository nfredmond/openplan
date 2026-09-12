from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[3]/'openplan'
e=Path('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12')
container='supabase_db_openplan-restore-target-2026091050'
def definition(name):
 return subprocess.check_output(['docker','exec',container,'psql','-X','-U','postgres','-d','postgres','-At','-c',f"SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='{name}';"],text=True)
manager=definition('assert_workspace_provider_api_manager')
save=definition('save_workspace_provider_api_revision')
revoke=definition('revoke_workspace_provider_api_connection')
immutable=definition('preserve_workspace_provider_api_revision')
connection=definition('preserve_workspace_provider_api_connection')
validate=definition('valid_workspace_provider_api_configuration')
def changed(source,before,after):
 assert source.count(before)==1,(before,source.count(before))
 return source.replace(before,after)
cases=[
 ('harmless-comment','-- This deliberately harmless SQL comment changes no behavior.',None),
 ('manager-role',changed(manager,"NOT IN ('owner','admin')","NOT IN ('owner','admin','member')"),'refuses member management'),
 ('revision-immutability',changed(immutable,'IF NEW IS DISTINCT FROM OLD THEN','IF false THEN'),'direct revision/key changes'),
 ('connection-identity',changed(connection,'(NEW.id,NEW.workspace_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.created_by,OLD.created_at)','false'),'direct revision/key changes'),
 ('revocation-monotonic',changed(connection,'OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at','false'),'revival after revocation'),
 ('revision-advance',changed(connection,'IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id AND','IF false AND'),'retains immutable revisions'),
 ('retry-author',changed(save,'OR revision.configured_by IS DISTINCT FROM p_user_id',''),'changed retry payloads'),
 ('retry-previous',changed(save,'revision.previous_revision_id IS DISTINCT FROM p_expected_revision_id','false'),'changed retry payloads'),
 ('retry-config',changed(save,'revision.configuration_canonical IS DISTINCT FROM p_configuration_canonical','false'),'changed retry payloads'),
 ('retry-key',changed(save,'stored_ciphertext IS DISTINCT FROM p_credential_ciphertext','false'),'changed retry payloads'),
 ('stale-edit',changed(save,'connection.current_revision_id IS DISTINCT FROM p_expected_revision_id','false'),'changed retry payloads'),
 ('stale-revoke',changed(revoke,'p_expected_revision_id IS NULL OR connection.current_revision_id IS DISTINCT FROM p_expected_revision_id','false'),'changed retry payloads'),
 ('key-mode',changed(save,"(config->>'authMode'='api_key' AND (p_credential_ciphertext IS NULL OR p_credential_ciphertext NOT LIKE 'v2:%'))",'false'),'validates protocol'),
 ('keyless-mode',changed(save,"config->>'authMode'='none' AND p_credential_ciphertext IS NOT NULL",'false'),'validates protocol'),
 ('config-validation',changed(validate,"IF jsonb_typeof(config) IS DISTINCT FROM 'object' THEN RETURN false; END IF;","RETURN true;"),'validates protocol'),
 ('connection-tenant-read','ALTER POLICY workspace_provider_api_connection_read ON public.workspace_provider_api_connections USING(true);','hides other workspaces'),
 ('revision-tenant-read','ALTER POLICY workspace_provider_api_revision_read ON public.workspace_provider_api_revisions USING(true);','hides other workspaces'),
 ('credential-disclosure','GRANT SELECT ON public.workspace_provider_api_credentials TO authenticated; CREATE POLICY mutation_disclose ON public.workspace_provider_api_credentials FOR SELECT TO authenticated USING(true);','hides other workspaces'),
 ('authenticated-rpc','GRANT EXECUTE ON FUNCTION public.save_workspace_provider_api_revision(uuid,uuid,uuid,uuid,uuid,text,text) TO authenticated;','hides other workspaces'),
]
records=[]
for name,sql,target in cases:
 mutation=e/f'storage-mutation-{name}.sql';mutation.write_text(sql)
 report=e/f'storage-mutation-{name}.json'
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050','OPENPLAN_API_CONFIG_MUTATION_SQL':str(mutation)}
 run=subprocess.run(['npm','exec','--','vitest','run','src/test/provider-api-connections-rls.test.ts','--reporter=default','--reporter=json','--outputFile',str(report)],cwd=root,env=env,text=True,capture_output=True,timeout=60)
 (e/f'storage-mutation-{name}.log').write_text(run.stdout+run.stderr)
 data=json.loads(report.read_text()); failures=[a['fullName'] for s in data['testResults'] for a in s['assertionResults'] if a['status']=='failed']
 if target is None: assert run.returncode==0 and data['numPassedTests']==8,(name,data)
 else: assert run.returncode!=0 and any(target in f for f in failures),(name,failures)
 records.append({'mutation':name,'outcome':'survived' if target is None else 'failed','target':target,'failedTests':failures})
 print(name,records[-1]['outcome'],flush=True)
 (e/'storage-mutations-progress.json').write_text(json.dumps(records,indent=2)+'\n')
(e/'storage-mutations.json').write_text(json.dumps({'mutations':records,'isolation':'Each mutation was applied inside each fixture transaction and rolled back. The named target is an explicitly disposable restore stack.','blindCategories':['No browser workflow or provider execution is exercised.','Concurrency requires separate simultaneous-session tests.','Service-role compromise is outside ordinary user/RLS authorization.']},indent=2)+'\n')
