"""Rollback controls and preservation reads for the owned recovered point."""
import hashlib,importlib.util,json,os,subprocess,sys,time
from pathlib import Path
OUT=Path(__file__).parent;POINT=OUT.parent;BASE=POINT.parent
ROLE=POINT/'target-cluster';API=POINT/'target-api';SOURCE=POINT/'source-seed-03'
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def main():
 os.umask(0o077);started=time.monotonic()
 sys.path.insert(0,str(API));import services,network_scope
 sys.path.insert(0,str(ROLE));import schema_semantics as semantic,resume_guards
 guard=load('final_guard',ROLE/'guards.py');archive=load('final_archive',REPO/'openplan/scripts/ops/full_restore.py')
 files=load('final_files',BASE/'probe_worker_file_backup.py')
 sys.path.append(str(BASE/'transit-coordinated-restore-20261011-03'))
 image=load('final_image',BASE/'transit-coordinated-restore-20261011-03/run.py');image.OUT=OUT
 receipt=json.loads((ROLE/'container-receipt.json').read_text());image.CONTAINER=receipt['id']
 database=json.loads((ROLE/'database-result.json').read_text())['targetDatabase']
 def verify():network_scope.verify_database_attachment(services.inspect(receipt['id']),receipt,'openplan_stagepoint_target_20261011_01',ROLE/'mounted-root-private.key',guard.verify_container,True)
 verify()
 if services.inspect(receipt['id'])['State']['Running']:raise ValueError('Owned target must begin stopped')
 before_repository=files.inventory(SOURCE/'repository-private')
 (OUT/'source-repository-before-private.json').write_text(json.dumps(before_repository,indent=2)+'\n')
 target_bundle=ROLE/'restored-private'/(SOURCE/'point-private').relative_to('/')
 target_before=files.inventory(target_bundle)
 baseline=json.loads((SOURCE/'captured-native-image-private.json').read_text())
 expected_text=(SOURCE/'captured-source-schema-private.sql').read_text()
 actual_text=(ROLE/'new-source-schema-private.log').read_text()
 source=json.loads((ROLE/'new-source-catalog-private.json').read_text())
 cases=[('baseline','',None),('harmless policy role ordering','ALTER POLICY equity_tract_designations_select ON public.equity_tract_designations TO authenticated, anon;',None),('changed native predicate','ALTER POLICY equity_tract_designations_select ON public.equity_tract_designations USING (false);','schema-policy-catalog'),('changed native policy role','ALTER POLICY equity_tract_designations_select ON public.equity_tract_designations TO service_role;','schema-policy-catalog'),('changed native default privilege','ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;','schema-default-catalog'),('restored','',None)]
 subprocess.run(['docker','start',receipt['id']],check=True,capture_output=True,timeout=20)
 try:
  for attempt in range(40):
   ready=subprocess.run(['docker','exec',receipt['id'],'pg_isready','-U','supabase_admin','-d',database],capture_output=True,timeout=5)
   if ready.returncode==0:break
   time.sleep(.25)
  else:raise RuntimeError('Owned target readiness timeout')
  verify();image.no_sessions(database);image.equal_image(baseline,image.inventory(database,'before-policy-controls'))
  import ownership_controls
  ownership_results=ownership_controls.run(database,image.sql,OUT,REPO,protected_path=target_bundle/'configuration-private')
  records=[]
  for label,mutation,expected in cases:
   query="BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; "+mutation+semantic.CATALOG_QUERY+'; ROLLBACK;'
   result=subprocess.run(['docker','exec','-i',receipt['id'],'psql','-XqAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],input=query.encode(),capture_output=True,timeout=45)
   (OUT/('native-policy-control-'+str(len(records))+'-private.log')).write_bytes(result.stdout+result.stderr);result.check_returncode()
   failure=None
   try:semantic.verify(expected_text,actual_text,source,json.loads(result.stdout))
   except ValueError as error:failure=str(error)
   resume_guards.native_control_reason(failure,expected)
   records.append({'case':label,'result':'intended refusal' if failure else 'survived','reason':failure,'transaction':'rolled back','nativeExitCode':result.returncode})
  semantic.verify(expected_text,actual_text,source,json.loads(archive.sql(receipt['id'],semantic.CATALOG_QUERY,database)))
  image.equal_image(baseline,image.inventory(database,'after-policy-controls'));image.no_sessions(database)
  bundle=ROLE/'restored-private'/(SOURCE/'point-private').relative_to('/');protected=bundle/'configuration-private'
  roles=(protected/'roles-private.sql').read_text()
  actual_roles=subprocess.check_output(['docker','exec',receipt['id'],'pg_dumpall','-U','supabase_admin','--roles-only'],stderr=subprocess.PIPE).decode()
  guard.verify_roles(json.loads((protected/'roles-inventory-private.json').read_text()),json.loads(archive.role_inventory(receipt['id'])),roles,actual_roles)
  guard.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),archive.database_properties(receipt['id'],database))
  archive._keys.require_mounted_bytes(receipt,archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
  census=json.loads((SOURCE/'point-file-inventory-private.json').read_text());files.equal(census,files.inventory(SOURCE/'point-private'))
  files.equal(target_before,files.inventory(target_bundle))
  files.equal(before_repository,files.inventory(SOURCE/'repository-private'));files.equal(before_repository,files.inventory(ROLE/'repository-private'))
  original=BASE/'transit-expanded-local-point-20261011-03'
  files.equal(json.loads((original/'point-file-inventory-private.json').read_text()),files.inventory(original/'source-point-private'))
  record={'state':'passed-native-final-preservation','ownershipOracleCases':ownership_results,'cases':records,'catalogPreservedAfterRollback':True,'all374TableImagesAndSixSequencesUnchanged':True,'rolesPasswordsMembershipsPropertiesAndMountedKeyEqual':True,'sourcePointAndEncryptedRepositoryUnchanged':True,'targetEncryptedRepositoryEqual':True,'originalTransitPointUnchanged':True,'wallSeconds':round(time.monotonic()-started,3),'scope':'Same-host separate-volume synthetic recovery point. Transactional policy/default-ACL controls, no Auth or browser acceptance.'}
 finally:
  verify();subprocess.run(['docker','stop','--time','10',receipt['id']],check=True,capture_output=True,timeout=25)
  verify()
  if services.inspect(receipt['id'])['State']['Running']:raise ValueError('Owned target did not stop')
 record['targetStopped']=True
 (OUT/'result.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'state':record['state'],'controls':len(records),'targetStopped':True}))
if __name__=='__main__':main()
