"""Capture the complete known admitted-stage root with its native database point."""
import hashlib,json,os,secrets,shutil,sys,time
from pathlib import Path
import seed_guards as guard
OUT=Path(__file__).parent;POINT=OUT.parent;BASE=POINT.parent
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
def capture(record,worker,cases,before,after,before_models,scope,original_point,receipt,database,started,*,image,files,root,archive,command,native_guard):
 run_ids=','.join("'"+c['run']+"'" for c in cases.values());stage_ids=','.join("'"+c['stage']+"'" for c in cases.values());claim_ids=','.join("'"+c.get('claimCommand',c['command'])['request_id']+"'" for c in cases.values());progress_id=cases['progress']['command']['request_id']
 filters={'public.model_runs':'id NOT IN ('+run_ids+')','public.model_run_stages':'id NOT IN ('+stage_ids+')','public.model_execution_custody_enrollment':'run_id NOT IN ('+run_ids+')','public.model_stage_attempts':'stage_id NOT IN ('+stage_ids+')','public.model_stage_claim_receipts':'request_id NOT IN ('+claim_ids+')','public.model_stage_write_receipts':"request_id<>'"+progress_id+"'",'public.model_stage_execution_starts':'stage_id NOT IN ('+stage_ids+')'}
 originals=[]
 for table,condition in filters.items():
  expected=next(r for r in before['tables'] if r['table']==table)
  query="SET search_path TO public,extensions;SELECT json_build_object('count',count(*),'sha256',encode(digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex')) FROM "+table+' t WHERE '+condition
  actual=json.loads(image.sql(database,query));guard.verify_original_rows({k:expected[k] for k in ('count','sha256')},actual);originals.append({'table':table,'oldRowsUnchanged':True})
 starts=json.loads(image.sql(database,"SELECT jsonb_agg(jsonb_build_object('stage_id',s.stage_id,'run_id',s.run_id,'boundary',s.boundary,'observed_at',s.observed_at,'after_stage_start',s.observed_at>=t.started_at) ORDER BY s.stage_id) FROM public.model_stage_execution_starts s JOIN public.model_run_stages t ON t.id=s.stage_id WHERE s.stage_id IN ("+stage_ids+")"));guard.verify_starts(starts,[(c['stage'],c['run']) for c in cases.values()])
 (OUT/'native-execution-starts-private.json').write_text(json.dumps(starts,indent=2)+'\n')
 model_id=cases['progress']['server']['run']['model_id'];timestamp=cases['progress']['server']['run']['updated_at']
 actual_models=json.loads(image.sql(database,"SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.models m"));guard.verify_model_touch(before_models,actual_models,model_id,timestamp)
 (OUT/'original-row-controls.json').write_text(json.dumps({'cases':originals,'selectedModelChangedOnlyToLatestSyntheticParentTimestamp':True},indent=2)+'\n')
 logical={name:root.sqlite_image(worker/name/'model-commands.sqlite3') for name in cases}
 source_before={name:row for name,row in root.inventory(worker).items() if name not in {key+'/model-commands.sqlite3-shm' for key in cases}}
 raw={name:{suffix:files.digest(worker/name/('model-commands.sqlite3'+suffix)) for suffix in ('','-wal')} for name in cases}
 controls=[];snapshots=OUT/'journal-snapshots';snapshots.mkdir(mode=0o700)
 for name in cases:
  root.equal_journal(logical[name],json.loads(json.dumps(logical[name],indent=4)))
  copied=OUT/('main-only-'+name);copied.mkdir(mode=0o700);main=copied/'model-commands.sqlite3';shutil.copy2(worker/name/'model-commands.sqlite3',main)
  failure=None
  try:root.equal_journal(logical[name],root.sqlite_image(main))
  except ValueError as e:failure=str(e)
  guard.verify_original_rows('model-point-journal-records-differ',failure)
  command([sys.executable,'-B',str(REPO/'openplan/scripts/ops/worker_journal_snapshot.py'),'--source',str(worker/name/'model-commands.sqlite3'),'--destination',str(snapshots/name),'--writers-quiesced'],name+'-actual-snapshot',30)
  root.equal_journal(logical[name],root.sqlite_image(snapshots/name/'model-commands.sqlite3'));controls.append({'journal':name,'harmlessLogicalSerializationEqual':True,'mainOnlyCopyRefused':'model-point-journal-records-differ','actualSnapshotAllLogicalRowsEqual':True})
 (OUT/'native-journal-controls.json').write_text(json.dumps(controls,indent=2)+'\n')
 base_bundle=original_point/'point-private';base_census=json.loads((original_point/'coordinated-point-file-inventory-private.json').read_text());files.equal(base_census,files.inventory(base_bundle))
 bundle=OUT/'point-private';shutil.copytree(base_bundle,bundle);files.equal(base_census,files.inventory(bundle));(bundle/'postgres.dump').unlink();image.dump(database,bundle/'postgres.dump','managed-full-native-dump')
 target=bundle/'managed-stage-worker-private'
 def omit(directory,names):return [name for name in names if name in {'model-commands.sqlite3','model-commands.sqlite3-wal','model-commands.sqlite3-shm'}] if Path(directory) in {worker/name for name in cases} else []
 shutil.copytree(worker,target,ignore=omit)
 for name in cases:shutil.copy2(snapshots/name/'model-commands.sqlite3',target/name/'model-commands.sqlite3')
 inventory=root.inventory(target);protected=bundle/'configuration-private'
 native_guard.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),archive.database_properties(receipt['id'],database))
 import importlib.util
 prior_scope=sys.modules['scope']
 try:
  spec=importlib.util.spec_from_file_location('captured_fresh_scope',POINT/'fresh-source-01/scope.py');fresh_scope=importlib.util.module_from_spec(spec);spec.loader.exec_module(fresh_scope);sys.modules['scope']=fresh_scope
  spec=importlib.util.spec_from_file_location('captured_fresh_properties',POINT/'fresh-source-01/properties.py');props=importlib.util.module_from_spec(spec);spec.loader.exec_module(props)
 finally:sys.modules['scope']=prior_scope
 properties=props.property_commands(database,database)
 for phase in ('source','target'):(protected/(phase+'-properties-private.sql')).write_text(properties)
 (protected/'properties-binding-private.json').write_text(json.dumps({phase:{'target':database,'sha256':hashlib.sha256(properties.encode()).hexdigest()} for phase in ('source','target')},indent=2)+'\n')
 roles=(protected/'roles-private.sql').read_text();native_guard.verify_roles(json.loads((protected/'roles-inventory-private.json').read_text()),json.loads(archive.role_inventory(receipt['id'])),roles,command(['docker','exec',receipt['id'],'pg_dumpall','-U','supabase_admin','--roles-only'],'source-final-roles').decode())
 archive._keys.require_mounted_bytes(receipt,archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
 (protected/'managed-stage-root-inventory-private.json').write_text(json.dumps(inventory,indent=2)+'\n');(protected/'managed-stage-logical-journals-private.json').write_text(json.dumps(logical,indent=2)+'\n')
 (protected/'managed-stage-source-scope-private.json').write_text(json.dumps({'logicalScope':scope,'sourceHead':record['sourceHead'],'sourceDatabaseId':receipt['id'],'sourceDatabase':database,'cases':cases,'callbacksBeforeCapture':record['callbacksBeforeCapture'],'attemptWorkspace':record['attemptWorkspace'],'journalSnapshotMapping':{name+'/model-commands.sqlite3':name for name in cases}},indent=2)+'\n')
 image.equal_image(after,image.inventory(database,'source-after-managed-capture'))
 for name in cases:root.equal_journal(logical[name],root.sqlite_image(worker/name/'model-commands.sqlite3'));root.equal_root(raw[name],{suffix:files.digest(worker/name/('model-commands.sqlite3'+suffix)) for suffix in raw[name]})
 root.equal_root(source_before,{name:row for name,row in root.inventory(worker).items() if name not in {key+'/model-commands.sqlite3-shm' for key in cases}});files.equal(base_census,files.inventory(base_bundle))
 complete=files.inventory(bundle);(OUT/'point-file-inventory-private.json').write_text(json.dumps(complete,indent=2)+'\n');(OUT/'captured-native-image-private.json').write_text(json.dumps(after,indent=2)+'\n')
 # Bind the supplemental expected schema observation to this exact unchanged image.
 shutil.copy2(POINT/'source-cluster/new-source-schema-private.log',OUT/'captured-source-schema-private.sql');shutil.copy2(POINT/'source-cluster/new-source-catalog-private.json',OUT/'captured-source-catalog-private.json')
 password=OUT/'password-private';password.write_text(secrets.token_urlsafe(48)+'\n');password.chmod(0o600);tool=BASE/'worker-backup-tool-20261011/restic';env={**os.environ,'GOMAXPROCS':'1','GOMEMLIMIT':'256MiB'}
 def restic(args,label):return command([str(tool),'--no-cache','--repo',str(OUT/'repository-private'),'--password-file',str(password),*args],label,300,env)
 restic(['init'],'managed-repository-init');summary=json.loads(restic(['backup','--json',str(bundle)],'managed-encrypted-backup').decode().strip().splitlines()[-1]);snapshot=summary['snapshot_id']
 restic(['check','--read-data'],'managed-encrypted-full-read-check');restic(['restore',snapshot,'--target',str(OUT/'restored-private'),'--verify'],'managed-encrypted-file-restore')
 restored=OUT/'restored-private'/bundle.relative_to('/');files.equal(complete,files.inventory(restored));files.equal(complete,files.inventory(bundle));root.equal_root(inventory,root.inventory(restored/'managed-stage-worker-private'))
 for name in cases:root.equal_journal(logical[name],root.sqlite_image(restored/'managed-stage-worker-private'/name/'model-commands.sqlite3'))
 image.no_sessions(database);image.equal_image(after,image.inventory(database,'source-final-managed-image'));files.equal(base_census,files.inventory(base_bundle))
 record.update(state='passed-native-managed-source-point',snapshotId=snapshot,wallSeconds=round(time.monotonic()-started,3),capturedFiles=len(complete),capturedBytes=sum(row['bytes'] for row in complete.values()),managedRootFiles=sum(row['kind']=='file' for row in inventory.values()),managedRootDirectories=sum(row['kind']=='directory' for row in inventory.values()),populatedManagedJournals=len(cases),allOriginalRowsUnchangedExceptSelectedModelTimestamp=True,nativeExecutionStartsRetained=2,sourceNativeImageUnchangedAfterCapture=True,sourceJournalBytesAndRowsUnchangedDuringCapture=True,encryptedFullReadCheck=True,originalPointUnchanged=True,separateTargetRecovery='pending',limits='Known synthetic admitted-stage source, fresh admission helper and bound writer only. Uncertain claim admits zero callbacks; progress occurs after one dummy callback and stops. No engine, normal poller integration, all-worker recovery, general writer fence, physical-host, browser, scientific or hosted acceptance.')
