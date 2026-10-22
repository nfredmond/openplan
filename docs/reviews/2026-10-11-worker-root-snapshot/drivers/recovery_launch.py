"""Run existing native recovery checks against fresh operator-packaged roots."""
import importlib.util, json, os, subprocess, sys, time
from pathlib import Path
OUT=Path(__file__).parent
BASE=OUT.parents[1]
POINT=BASE/'managed-stage-point-20261011-01'
PACKAGES=BASE/'worker-root-snapshot-20261011/native-packages-03'
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
sys.path.insert(0,str(OUT))
sys.path.insert(0,str(POINT/'target-api'))
import services,network_scope
import recovery_lifecycle as lifecycle

def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 os.umask(0o077)
 files=load('package_resume_files',BASE/'probe_worker_file_backup.py')
 guard=load('package_resume_cluster_guard',POINT/'target-cluster/guards.py')
 db=json.loads((POINT/'target-cluster/container-receipt.json').read_text())
 rest=json.loads((POINT/'target-api/source-rest-receipt-private.json').read_text())
 connection=json.loads((POINT/'target-api/source-rest-connection-private.json').read_text())
 dependencies=json.loads((POINT/'target-recovery-01/pre-execution-source-sha256.json').read_text())
 for path in (OUT/'launch.py',OUT/'run_recovery.py',OUT/'recovery_guards.py',OUT/'recovery_lifecycle.py',OUT/'verify_recovery_lifecycle.py',PACKAGES/'run.py',REPO/'openplan/scripts/ops/worker_root_snapshot.py'):
  dependencies[str(path)]=files.digest(path)
 files.equal(dependencies,{path:files.digest(Path(path)) for path in dependencies})
 (OUT/'pre-execution-source-private.json').write_text(json.dumps(dependencies,indent=2)+'\n')
 frozen=OUT/'executed-source-private';frozen.mkdir(mode=0o700)
 for index,path in enumerate(dependencies):(frozen/(str(index)+'-'+Path(path).name)).write_bytes(Path(path).read_bytes())
 package_census=json.loads((PACKAGES/'packages-before-private.json').read_text())
 files.equal(package_census,files.inventory(PACKAGES/'packages-private'))
 def database():
  network_scope.verify_database_attachment(services.inspect(db['id']),db,'openplan_stagepoint_target_20261011_01',POINT/'target-cluster/mounted-root-private.key',guard.verify_container,True)
 def api():services.verify_new('rest',services.inspect(rest['id']),rest,connection['database'],Path('/unused'),Path('/unused'))
 database();api()
 lifecycle.require_stopped(services.inspect(db['id']),services.inspect(rest['id']))
 info=services.inspect(rest['id']);binding=info['HostConfig']['PortBindings']['3000/tcp'][0]
 if binding['HostPort']:
  services.port_free(binding['HostIp'],int(binding['HostPort']))
 # Empty HostPort requests a fresh Docker-assigned loopback port. The exact
 # service guard above verifies the request; no fixed port is commandeered.
 started=[]
 try:
  for identity,observe in ((db['id'],database),(rest['id'],api)):
   observe();started.append((identity,observe));subprocess.run(['docker','start',identity],capture_output=True,check=True,timeout=30);observe()
   if identity==db['id']:
    for attempt in range(40):
     result=subprocess.run(['docker','exec',identity,'pg_isready','-U','supabase_admin','-d',connection['database']],capture_output=True,timeout=5)
     if result.returncode==0:break
     time.sleep(.25)
    else:raise RuntimeError('Owned target readiness timeout')
  recovery=load('package_native_recovery',OUT/'run_recovery.py')
  recovery.main()
 finally:
  for identity,observe in reversed(started):
   observe()
   if services.inspect(identity)['State']['Running']:subprocess.run(['docker','stop','--time','10',identity],capture_output=True,check=True,timeout=25)
   observe();lifecycle.require_final_stopped(services.inspect(identity))
 files.equal(package_census,files.inventory(PACKAGES/'packages-private'))
 files.equal(dependencies,{path:files.digest(Path(path)) for path in dependencies})
 result=json.loads((OUT/'result.json').read_text())
 result.update(immutableOperatorPackagesUnchanged=True,allDependenciesUnchanged=True,exactOwnedTargetStoppedAfterFinally=True,workingRootOrigin='Supported root CLI package copied to a fresh runtime root. Accepted retained point and original target files are unchanged.')
 (OUT/'result.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'state':'passed-supported-package-native-recovery','packagesUnchanged':True,'callbacks':result['computationCallbacks']}))
if __name__=='__main__':main()
