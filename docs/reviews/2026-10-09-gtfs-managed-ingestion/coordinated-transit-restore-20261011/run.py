"""Retain a coordinated native database and complete private GTFS file point."""
import copy, datetime, hashlib, importlib.util, json, os, re, secrets, shutil, subprocess, time
from pathlib import Path
from preflight import CONTAINER, HEAD, TEMPLATE, TARGET, require, verify_scope
from transport import bridge, gateway, inspect

OUT=Path(__file__).parent
PROOF=OUT.parent
APP=Path('/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011/openplan')
SOURCE=PROOF/'capacity-20261011-01/worker-private'
BACKUP=PROOF/'worker-backup-tool-20261011/native-01'
RESTORED=BACKUP/'restored-private'/SOURCE.relative_to('/')
TOOL=PROOF/'worker-backup-tool-20261011/restic'
TOOL_SHA='20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'
record={'state':'preflight','sourceHead':HEAD,'backendStops':[],'http':{},'replays':[],'commands':[]}

def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        while part:=stream.read(1048576):value.update(part)
    return value.hexdigest()

def save():
    path=OUT/'progress-private.json';path.write_text(json.dumps(record,indent=2)+'\n')

def sql(database,query):
    require(database==TEMPLATE or database=='postgres' or re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',database),'coordinated-sql-database')
    result=subprocess.run(['docker','exec',CONTAINER,'psql','-U','supabase_admin','-d',database,'-XqAt','-v','ON_ERROR_STOP=1','-c',query],capture_output=True,text=True,timeout=90)
    require(result.returncode==0,'coordinated-sql-failed')
    return result.stdout.strip()

def no_sessions(database):
    require(int(sql('postgres',"SELECT count(*) FROM pg_stat_activity WHERE datname='"+database+"'"))==0,'coordinated-writers-present')

def inventory(database,label):
    tables=json.loads(sql(database,"SELECT coalesce(json_agg(format('%I.%I',n.nspname,c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','m') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'"))
    values=[]
    for table in tables:
        require(re.fullmatch(r'[a-z0-9_]+\.[a-z0-9_]+',table),'coordinated-table-name')
        value=json.loads(sql(database,"SET search_path TO public,extensions; SELECT json_build_object('count',count(*),'sha256',encode(digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex')) FROM "+table+' t'))
        values.append({'table':table,**value})
    sequences=json.loads(sql(database,"SELECT coalesce(json_agg(format('%I.%I',n.nspname,c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname !~ '^pg_'"))
    seq=[]
    for name in sequences:
        require(re.fullmatch(r'[a-z0-9_]+\.[a-z0-9_]+',name),'coordinated-sequence-name')
        seq.append({'sequence':name,**json.loads(sql(database,'SELECT row_to_json(t) FROM (SELECT last_value,is_called FROM '+name+') t'))})
    schema=subprocess.check_output(['docker','exec',CONTAINER,'pg_dump','-U','supabase_admin','-d',database,'--schema-only'],stderr=subprocess.PIPE,timeout=120)
    normalized=b'\n'.join(line for line in schema.splitlines() if not line.startswith((b'--',b'\\restrict ',b'\\unrestrict ')))
    result={'tables':values,'sequences':seq,'schemaSha256':hashlib.sha256(normalized).hexdigest()}
    (OUT/(label+'-inventory-private.json')).write_text(json.dumps(result,indent=2)+'\n')
    return result

def equal_image(expected,actual):
    require(expected['tables']==actual['tables'],'coordinated-table-image-differs')
    require(expected['sequences']==actual['sequences'],'coordinated-sequence-image-differs')
    require(expected['schemaSha256']==actual['schemaSha256'],'coordinated-schema-image-differs')

def dump(database,path,label):
    start=time.monotonic()
    with path.open('xb') as stream:
        result=subprocess.run(['docker','exec',CONTAINER,'pg_dump','-U','supabase_admin','-d',database,'--format=custom'],stdout=stream,stderr=subprocess.PIPE,timeout=180)
        stream.flush();os.fsync(stream.fileno())
    (OUT/(label+'-private.log')).write_bytes(result.stderr)
    require(result.returncode==0,'coordinated-dump-failed')
    record['commands'].append({'name':label,'exitCode':result.returncode,'bytes':path.stat().st_size,'sha256':digest(path),'wallSeconds':round(time.monotonic()-start,3)});save()

def restore(database,path,label):
    require(not json.loads(sql('postgres',"SELECT coalesce(json_agg(datname),'[]') FROM pg_database WHERE datname='"+database+"'")),'coordinated-existing-database')
    sql('postgres','CREATE DATABASE '+database+' TEMPLATE template0')
    start=time.monotonic()
    with path.open('rb') as stream:
        result=subprocess.run(['docker','exec','-i',CONTAINER,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--single-transaction'],stdin=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
    (OUT/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
    require(result.returncode==0,'coordinated-restore-failed')
    record['commands'].append({'name':label,'exitCode':result.returncode,'wallSeconds':round(time.monotonic()-start,3)});save()

def restic(repository,password,args,label):
    env={k:v for k,v in os.environ.items() if not k.startswith('RESTIC_')};env['GOMAXPROCS']='1'
    start=time.monotonic()
    result=subprocess.run([str(TOOL),'--no-cache','--repo',str(repository),'--password-file',str(password),*args],env=env,capture_output=True,timeout=180)
    (OUT/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
    require(result.returncode==0,'coordinated-restic-failed')
    record['commands'].append({'name':label,'exitCode':result.returncode,'wallSeconds':round(time.monotonic()-start,3),'logSha256':digest(OUT/(label+'-private.log'))});save()
    return result.stdout

def run_replay(root,connection,bridge_url,label,mode,expected,fixture,refusal=None,extra=None):
    candidates=list(root.glob('*/version-'+fixture['versionId']+'/attempt-*/commands'))
    require(len(candidates)==1,'coordinated-command-census');commands=candidates[0]
    config={'commands':str(commands),'artifact':str(commands.parent/'artifact'),'target':TARGET,'bridge':bridge_url,'versionId':fixture['versionId'],'feedId':fixture['feedId'],**fixture['expectedBinding'],'expectedTerminal':expected,**(extra or {})}
    path=OUT/(label+'-configuration-private.json');path.write_text(json.dumps(config))
    env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':TARGET,'SUPABASE_SERVICE_ROLE_KEY':connection['token'],'NODE_OPTIONS':'--max-old-space-size=768'}
    start=time.monotonic()
    result=subprocess.run(['/usr/bin/node','--conditions=react-server','--import',str(APP/'node_modules/tsx/dist/loader.mjs'),str(OUT/'replay.mts'),str(path),mode],cwd=APP,env=env,capture_output=True,text=True,timeout=60)
    (OUT/(label+'-private.log')).write_text(result.stdout+result.stderr)
    rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    require(len(rows)==1,'coordinated-child-observation');row=rows[0]
    if refusal:require(result.returncode==2 and row.get('reason')==refusal,'coordinated-intended-refusal')
    else:require(result.returncode==0 and row.get('state')=='recovered_terminal','coordinated-child-success')
    require(row.get('computations')==0,'coordinated-recomputation')
    record['replays'].append({'case':label,'exitCode':result.returncode,'wallSeconds':round(time.monotonic()-start,3),**row});save()
    return row,commands

def main():
    os.umask(0o077);plan=json.loads((OUT/'plan.json').read_text());record['startedAt']=stamp()
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=APP,text=True).strip();dirty=subprocess.check_output(['git','status','--porcelain'],cwd=APP,text=True).strip()
    info=inspect(CONTAINER)
    # Check native identity before issuing the first database read.
    verify_scope(plan,info,head,dirty,[],False)
    active=any(subprocess.check_output(['systemctl','--user','show',unit,'-p','ActiveState','--value'],text=True).strip() in ('active','activating') for unit in ('openplan-gtfs-cta-capacity-20261011-01.service','openplan-gtfs-worker-file-replay-20261011-01.service','openplan-gtfs-counter-full-archive-20261011-01.service'))
    existing=json.loads(sql('postgres',"SELECT json_agg(datname) FROM pg_database"));verify_scope(plan,info,head,dirty,existing,active)
    require(digest(TOOL)==TOOL_SHA,'coordinated-backup-tool')
    spec=importlib.util.spec_from_file_location('file_probe',PROOF/'probe_worker_file_backup.py');files=importlib.util.module_from_spec(spec);spec.loader.exec_module(files)
    census=json.loads((BACKUP/'source-inventory-private.json').read_text());files.equal(census,files.inventory(SOURCE));files.equal(census,files.inventory(RESTORED))
    fixture=json.loads((PROOF/'capacity-20261011-01/capacity-native.json').read_text())
    baseline=inventory(TEMPLATE,'template-before');dump(TEMPLATE,OUT/'template.dump','template-readonly-capture');equal_image(baseline,inventory(TEMPLATE,'template-after'))
    source,target=plan['sourceDatabase'],plan['targetDatabase'];restore(source,OUT/'template.dump','source-restore');equal_image(baseline,inventory(source,'source-initial'))
    bundle=OUT/'snapshot-input-private';bundle.mkdir(mode=0o700);root=bundle/'worker-private';shutil.copytree(RESTORED,root);root.chmod(0o700)
    candidates=list(root.glob('*/version-'+fixture['versionId']+'/attempt-*/commands'));require(len(candidates)==1,'coordinated-command-census')
    terminal=candidates[0]/'command-terminal/pending.json';expected=json.loads(terminal.read_text())
    require(expected['resolved'] and expected['payload']['operation']=='complete','coordinated-original-completion')
    pending=copy.deepcopy(expected);pending.update(resolved=False,receipt=None);terminal.write_text(json.dumps(pending));terminal.chmod(0o600)
    before_lost=files.inventory(root);record['http']['lost']=[];save()
    with gateway(source,OUT,record['backendStops']) as connection:
        with bridge(connection,True,record['http']['lost']) as bridge_url:
            run_replay(root,connection,bridge_url,'lost-replayed-completion-reply','uncertain',expected,fixture,'GTFS worker acknowledgement unavailable')
    no_sessions(source);files.equal(before_lost,files.inventory(root))
    replies=[r for r in record['http']['lost'] if r.get('path')=='/rest/v1/rpc/complete_gtfs_ingest']
    require(replies and all(r['status']==200 and r['dropped'] for r in replies),'coordinated-native-reply-not-dropped')
    require(len({(r['requestSha256'],r['responseSha256']) for r in replies})==1,'coordinated-replayed-reply-differs')
    equal_image(baseline,inventory(source,'source-after-reply-loss'))
    record['state']='quiesced-capture';record['noWriterIntervalStartedAt']=stamp();save();no_sessions(source)
    dump(source,bundle/'postgres.dump','coordinated-database-capture')
    captured=files.inventory(bundle);equal_image(baseline,inventory(source,'source-after-capture'));no_sessions(source);files.equal(captured,files.inventory(bundle))
    repository=OUT/'repository-private';password=OUT/'password-private';password.write_text(secrets.token_hex(32));password.chmod(0o600)
    restic(repository,password,['init','--repository-version','2'],'encrypted-initialize')
    raw=restic(repository,password,['backup','--json','--force',str(bundle)],'encrypted-coordinated-capture')
    summaries=[json.loads(line) for line in raw.decode().splitlines() if line.startswith('{')]
    snapshot=next(r for r in summaries if r.get('message_type')=='summary')['snapshot_id'];require(re.fullmatch('[0-9a-f]{64}',snapshot),'coordinated-snapshot-id')
    restic(repository,password,['check','--read-data'],'encrypted-complete-data-check')
    restored_base=OUT/'coordinated-restored-private';restic(repository,password,['restore',snapshot,'--target',str(restored_base),'--verify'],'encrypted-coordinated-restore')
    restored_bundle=restored_base/bundle.relative_to('/');files.equal(captured,files.inventory(restored_bundle));files.equal(captured,files.inventory(bundle));no_sessions(source)
    record['noWriterIntervalEndedAt']=stamp();record['coordinatedSnapshotId']=snapshot;record['capturedFiles']=len(captured);record['capturedBytes']=sum(r['bytes'] for r in captured.values());record['state']='restore-target';save()
    restore(target,restored_bundle/'postgres.dump','target-restore');equal_image(baseline,inventory(target,'target-before-recovery'))
    # Remove only a receipt inside one rollback-only session. Compare its actual
    # native result before rollback, then verify the entire restored image again.
    no_sessions(target)
    version=fixture['versionId'];require(re.fullmatch('[0-9a-f-]{36}',version),'coordinated-control-version')
    changed=json.loads(sql(target,"BEGIN; SET search_path TO public,extensions; DELETE FROM openplan_gtfs.completion_receipts WHERE version_id='"+version+"'; SELECT json_build_object('count',count(*),'sha256',encode(digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex')) FROM openplan_gtfs.completion_receipts t; ROLLBACK;"))
    broken=copy.deepcopy(baseline);receipt=next(r for r in broken['tables'] if r['table']=='openplan_gtfs.completion_receipts');receipt.update(changed)
    try:equal_image(baseline,broken)
    except ValueError as error:require(str(error)=='coordinated-table-image-differs','coordinated-control-wrong-refusal')
    else:raise AssertionError('Missing native receipt survived image comparison')
    equal_image(baseline,inventory(target,'target-control-rolled-back'));record['nativeIncompleteImageRefused']=True;record['nativeControlRolledBack']=True;save()
    restored_root=restored_bundle/'worker-private';restored_before=files.inventory(restored_root)
    record['http']['recovery']=[]
    with gateway(target,OUT,record['backendStops']) as connection:
        with bridge(connection,False,record['http']['recovery']) as bridge_url:
            _,commands=run_replay(restored_root,connection,bridge_url,'restored-native-completion','uncertain',expected,fixture)
            resolved=commands/'command-terminal/pending.json';require(json.loads(resolved.read_text())==expected,'coordinated-terminal-receipt-differs')
            run_replay(restored_root,connection,bridge_url,'restored-cached-repeat','cached',expected,fixture)
            run_replay(restored_root,connection,bridge_url,'harmless-review-note','cached',expected,fixture,extra={'reviewerNote':'Unrelated'})
            run_replay(restored_root,connection,bridge_url,'wrong-installation','wrong-installation',expected,fixture,'GTFS journal attempt scope differs')
    no_sessions(target);equal_image(baseline,inventory(target,'target-after-recovery'));equal_image(baseline,inventory(source,'source-final'));equal_image(baseline,inventory(TEMPLATE,'template-final'))
    final=files.inventory(restored_root);changed=[name for name in restored_before if restored_before[name]!=final.get(name)];require(changed==[resolved.relative_to(restored_root).as_posix()],'coordinated-unrelated-file-changed')
    require(set(final)==set(restored_before),'coordinated-restored-file-census');files.equal(census,files.inventory(SOURCE));files.equal(census,files.inventory(RESTORED));files.equal(captured,files.inventory(bundle))
    record.update(state='passed',finishedAt=stamp(),tableCount=len(baseline['tables']),sequenceCount=len(baseline['sequences']),schemaEqual=True,nativeAllImagesEqual=True,originalFilesUnchanged=True,capturedBundleUnchanged=True,restoredOnlyTerminalReceiptChanged=True,workerFiles=len(census),workerBytes=sum(r['bytes'] for r in census.values()),limits=plan['limits'])
    save();(OUT/'result.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'passed':True,'tables':record['tableCount'],'sequences':record['sequenceCount'],'replays':len(record['replays'])}),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as error:
        record.update(state='failed',errorType=type(error).__name__,failedAt=stamp());save();raise
