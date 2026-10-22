import argparse,json,os,re,subprocess,sys,uuid
from pathlib import Path

def run(repo,out,source_config):
 os.umask(0o077);out.mkdir(mode=0o700)
 config=json.loads(source_config.read_text());assert config['container']=='supabase_db_openplan-restore-target-2026091050' and re.fullmatch('openplan_attempt_cli_[a-f0-9]{32}',config['database'])
 name='openplan_attempt_cli_'+uuid.uuid4().hex
 sql="SELECT count(*) FROM pg_stat_activity WHERE datname='"+config['database']+"'"
 cmd=['docker','exec','-i',config['container'],'psql','-U','postgres','-d','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1']
 r=subprocess.run(cmd,input=sql,text=True,capture_output=True,check=True,timeout=15);assert r.stdout.strip()=='0','Template has no active sessions'
 subprocess.run(cmd,input='CREATE DATABASE '+name+' TEMPLATE '+config['database'],text=True,capture_output=True,check=True,timeout=30)
 config={**config,'database':name};(out/'database-private.json').write_text(json.dumps(config)+'\n')
 job=dict(zip(['workspaceId','missionId','processingJobId'],[str(uuid.uuid4()) for _ in range(3)]));(out/'job-private.json').write_text(json.dumps(job)+'\n')
 sys.path.insert(0,str(repo/'docs/reviews/2026-10-09-gtfs-ingest-recovery'))
 from isolated_storage_owned import storage
 with storage(config) as native:
  env={**os.environ,'OPENPLAN_PROOF_STORAGE_URL':native['url'],'OPENPLAN_PROOF_STORAGE_TOKEN':native['token'],'OPENPLAN_PROOF_OUT':str(out)}
  r=subprocess.run(['node',str(Path(__file__).with_name('native_storage.mjs'))],cwd=repo/'openplan',env=env,capture_output=True,text=True,timeout=90)
  (out/'native-private.log').write_text(r.stdout+r.stderr)
  assert r.returncode==0,'Native custody preserves original stored bytes'
  report=json.loads((out/'native.json').read_text());report.update(storageImage=native['image'],retainedDatabase=name)
  (out/'native.json').write_text(json.dumps(report,indent=2)+'\n');print(report)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--config',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve(),a.config.resolve())
