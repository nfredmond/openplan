from pathlib import Path
import subprocess,json,hashlib,os,re
root=Path(__file__).resolve().parents[4]/'openplan'
container=os.environ.get('OPENPLAN_CASCADE_TEST_CONTAINER','')
if not re.fullmatch(r'supabase_db_openplan-restore-target-[1-9][0-9]*',container):
 raise SystemExit('Set OPENPLAN_CASCADE_TEST_CONTAINER to a disposable restore-target database')
source=root/'supabase/migrations/20261016000009_land_use_plan_cascade_guards.sql'
original=source.read_text()
out=Path('/tmp/openplan-cascade-controls');out.mkdir(exist_ok=True)
order=(root/'src/test/fixtures/land-use-plans/cascade-order.sql').read_text()
guard="  IF TG_OP = 'DELETE' AND NOT public.land_use_plan_version_has_live_owner(OLD.version_id) THEN\n    RETURN OLD;\n  END IF;\n"
def change_function(text,name,old,new):
 start=text.index('CREATE OR REPLACE FUNCTION public.'+name+'()')
 end=text.index('$$;',start)+3
 block=text[start:end]
 assert block.count(old)==1,(name,old)
 return text[:start]+block.replace(old,new)+text[end:]
def run(label,sql,fixture='freeze-persistence',workspace=False,expected=None):
 body=(root/f'src/test/fixtures/land-use-plans/{fixture}.sql').read_text()
 if expected is not None: assert sql != original, 'Fault did not change source'
 command="BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s'; SET LOCAL openplan.test_cascade_workspace='"+('1' if workspace else '0')+"';\n"+sql+order+'\n'+body+'\nROLLBACK;'
 result=subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=command,text=True,capture_output=True,timeout=30)
 (out/(label+'.log')).write_text(result.stdout+result.stderr)
 success=(result.returncode==0) if expected is None else (result.returncode==3 and expected in result.stderr and 'syntax error' not in result.stderr)
 record={'case':label,'expectedPass':expected is None,'exitCode':result.returncode,'matched':success,'expectedFailure':expected,'fixture':fixture,'workspace':workspace}
 results.append(record);print(label,success,flush=True)
 if not success:raise RuntimeError(result.stdout+result.stderr)
results=[]
try:
 for fixture,workspace in [('creation',False),('freeze-persistence',False),('freeze-persistence',True),('context-persistence',False),('context-persistence',True),('draft-revision',False)]:
  run('baseline-'+fixture+('-workspace' if workspace else ''),original,fixture,workspace)
 run('harmless',original+'\n-- Harmless native guard control.\n')
 run('old-creation','',fixture='creation',expected='violates foreign key constraint "land_use_plan_versions_workspace_id_fkey"')
 run('old-freeze','',expected='Frozen land-use plan content is immutable')
 run('missing-counter-cascade',change_function(original,'advance_land_use_plan_child_revision',guard,''),fixture='creation',expected='violates foreign key constraint "land_use_plan_versions_workspace_id_fkey"')
 run('missing-content-cascade',change_function(original,'refuse_frozen_land_use_plan_content',guard,''),expected='Frozen land-use plan content is immutable')
 run('missing-action-cascade',change_function(original,'limit_frozen_land_use_plan_action_update',guard,''),workspace=True,expected='A frozen implementation action may only update status and implementation evidence')
 run('missing-journal-workspace-cascade',original.replace(' OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id)',''),workspace=True,expected='Land-use plan decisions and frozen implementation reports are append-only')
 run('missing-receipt-workspace-fk',original[:original.index('-- Delete the workspace-owned receipt')],workspace=True,expected='violates foreign key constraint "land_use_plan_freeze_commands_review_event_id_workspace_id_fkey"')
 for function,label,fixture,error in [
 ('advance_land_use_plan_child_revision','counter-bypass','draft-revision','land_use_plan_designation_policy_links delete revision delta'),
 ('refuse_frozen_land_use_plan_content','frozen-content-bypass','freeze-persistence','direct frozen content deletion refused: accepted'),
 ('limit_frozen_land_use_plan_action_update','frozen-action-bypass','freeze-persistence','direct frozen action deletion refused: accepted')]:
  mutant=change_function(original,function,guard,"  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;\n")
  run(label,mutant,fixture=fixture,expected=error)
 start=original.index("  IF TG_OP = 'DELETE' AND (NOT EXISTS (")
 end=original.index('  RAISE EXCEPTION',start)
 run('append-only-delete-bypass',original[:start]+"  IF TG_OP='DELETE' THEN RETURN OLD; END IF;\n"+original[end:],expected='direct journal deletion refused: accepted')
 run('helper-hides-live-owner',original.replace('  SELECT EXISTS (','  SELECT false AND EXISTS (',1),expected='direct frozen content deletion refused: accepted')
 run('helper-hides-parent-deletion',original.replace('  SELECT EXISTS (','  SELECT true OR EXISTS (',1),fixture='creation',expected='violates foreign key constraint "land_use_plan_versions_workspace_id_fkey"')
finally:
 report={'results':results,'sourceUnchanged':source.read_text()==original,'sha256':hashlib.sha256(original.encode()).hexdigest(),'boundary':'Rollback-only PostgreSQL fixtures and reordered equivalent constraints. No full archive restore, browser, practitioner or release acceptance.'}
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
