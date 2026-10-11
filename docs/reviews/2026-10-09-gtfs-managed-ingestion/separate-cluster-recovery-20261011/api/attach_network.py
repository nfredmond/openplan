"""Attach only the verified new database to one private fixture network."""
import importlib.util, json, os, subprocess
from pathlib import Path
import network_scope as n
import services
from scope import DB_ID, NETWORK

OUT = Path(__file__).parent
ROLE = OUT.parent / 'separate-cluster-point-20261011-02'
spec = importlib.util.spec_from_file_location('owned_role_guard', ROLE / 'guards.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
receipt = json.loads((ROLE / 'container-receipt.json').read_text())
VOLUME = 'openplan_gtfs_separate_cluster_20261011_02'
KEY = ROLE / 'mounted-root-private.key'
record = {'state': 'prepared', 'commands': []}


def command(args, label):
    result = subprocess.run(args, capture_output=True, timeout=30)
    (OUT / (label+'-private.log')).write_bytes(result.stdout+result.stderr)
    record['commands'].append({'case':label,'exitCode':result.returncode})
    (OUT / 'network-progress.json').write_text(json.dumps(record,indent=2)+'\n')
    result.check_returncode(); return result.stdout


def main():
    os.umask(0o077); OUT.chmod(0o700)
    n.verify_database_attachment(services.inspect(DB_ID), receipt, VOLUME, KEY, guard.verify_container, False)
    exists = subprocess.run(['docker','network','inspect',NETWORK],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0
    if exists: raise ValueError('Retain existing network and reconcile its identity before continuing')
    identity = command(['docker','network','create','--driver','bridge','--internal','--label','openplan.purpose='+n.PURPOSE,NETWORK],'create-private-network').decode().strip()
    record['networkId'] = identity
    info = json.loads(command(['docker','network','inspect',identity],'read-new-network'))[0]
    subnet = n.verify_network(info,identity,set())
    # Docker's none network cannot coexist with a private bridge. Both operations
    # address only the exact new database and the newly recorded network.
    command(['docker','network','disconnect','none',DB_ID],'disconnect-new-database-none')
    command(['docker','network','connect',identity,DB_ID],'attach-new-database-private-network')
    n.verify_database_attachment(services.inspect(DB_ID),receipt,VOLUME,KEY,guard.verify_container,True)
    info = json.loads(command(['docker','network','inspect',identity],'read-attached-network'))[0]
    n.verify_network(info,identity,{DB_ID})
    rule = n.hba_rule(subnet).encode()
    before = command(['docker','exec',DB_ID,'cat','/var/lib/postgresql/data/proof/pg_hba.conf'],'before-private-hba')
    # The only new host rule is bound to this verified private subnet. Existing
    # local rules and captured role password hashes stay intact.
    result = subprocess.run(['docker','exec','-i',DB_ID,'sh','-c','cat >> /var/lib/postgresql/data/proof/pg_hba.conf'],input=b'\n'+rule,capture_output=True,timeout=10)
    result.check_returncode()
    after = command(['docker','exec',DB_ID,'cat','/var/lib/postgresql/data/proof/pg_hba.conf'],'after-private-hba')
    if after != before+b'\n'+rule: raise ValueError('Private HBA append differs')
    command(['docker','exec',DB_ID,'psql','-XqAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c','SELECT pg_reload_conf()'],'reload-private-hba')
    record.update(state='passed-native-network-attachment',databaseId=DB_ID,subnet=subnet,databasePortPublished=False,internalNetwork=True,originalApiServicesChanged=False)
    (OUT/'network-result.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'state':record['state'],'subnet':subnet}),flush=True)


if __name__ == '__main__': main()
