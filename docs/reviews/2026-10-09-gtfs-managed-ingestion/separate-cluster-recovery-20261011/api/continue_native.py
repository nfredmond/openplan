"""Recover retained commands through the verified separate cluster APIs."""
import hashlib, importlib.util, json, os, subprocess, sys, time
from pathlib import Path
import requests
import run as r, services, network_scope as n, bridge, continuation_guards as guard
from start_services import verify_result
from scope import DB_ID, DATABASE, NETWORK

OUT=Path(__file__).parent;ROLE=OUT.parent/'separate-cluster-point-20261011-02'
sys.path.append(str(ROLE))
import run_database as database, schema_semantics as schema, resume_guards

def main():
    os.umask(0o077);started=time.monotonic()
    point=OUT.parent/'transit-expanded-local-point-20261011-03'
    restored=ROLE/'restored-private'/(point/'source-point-private').relative_to('/')
    protected=restored/'configuration-private';storage=restored/'storage-objects'
    receipt=json.loads((ROLE/'container-receipt.json').read_text())
    verify_result(json.loads((ROLE/'database-continuation-02-result.json').read_text()))
    n.verify_database_attachment(services.inspect(DB_ID),receipt,database.VOLUME,ROLE/'mounted-root-private.key',database.g.verify_container,True)
    state=json.loads((OUT/'api-service-receipts-private.json').read_text())
    peers={DB_ID}
    for kind,value in state['services'].items():
        services.verify_new(kind,services.inspect(value['id']),value,DATABASE,storage,OUT/'api-kong-runtime-private.json')
        peers.add(value['id'])
    network=json.loads((OUT/'network-result.json').read_text())
    info=json.loads(subprocess.check_output(['docker','network','inspect',network['networkId']]))[0]
    subnet=n.verify_network(info,network['networkId'],peers)
    gateway=services.inspect(state['services']['gateway']['id'])
    native=guard.binding(state,receipt,gateway['NetworkSettings']['Networks'][NETWORK]['IPAddress'],subnet)
    session=requests.Session();session.trust_env=False;statuses=[]
    for path in ('/auth/v1/health','/rest/v1/gtfs_feed_versions?select=id&limit=0','/storage/v1/status'):
        with session.get(native+path,headers={'apikey':state['service_key'],'Authorization':'Bearer '+state['service_key']},timeout=3) as response:statuses.append(response.status_code)
    r.s.require(services.ready_status(*statuses),'expanded-stack-readiness')
    r.record.update(state='native-api-continuation',logicalApi=r.s.API,nativeApi=native,cliSourceHead='f72d4b5910dd08ace916ee585cb9fa2749a408e2',parserContextHead=r.s.HEAD,readiness=statuses)
    r.save()
    original=json.loads((point/'point-file-inventory-private.json').read_text())
    r.files.equal(original,r.files.inventory(restored))
    expected=json.loads((protected/'object-manifest-private.json').read_text())
    logical=r.s.API
    try:
        r.s.API=native
        r.storage_readback(DATABASE,storage,state['service_key'],'separate-native',expected)
    finally:r.s.API=logical
    bridge.API=native
    fixture=json.loads((OUT.parent/'capacity-20261011-01/capacity-native.json').read_text())
    r.cli(restored/'gtfs-capacity',state['service_key'],'separate-original-command-recovered',False,fixture,json.loads((protected/'expected-terminal-private.json').read_text()))
    expected_http=json.loads((point/'resume-progress-private.json').read_text())['http']['target-original-command-recovered']
    expected_completions=[row for row in expected_http if row.get('path','').endswith('complete_gtfs_ingest')]
    actual_completions=[row for row in r.record['http']['separate-original-command-recovered'] if row.get('path','').endswith('complete_gtfs_ingest')]
    guard.replies(expected_completions,actual_completions)
    allowed=json.loads((point/'resumed-final-verification.json').read_text())['changedFiles']
    changes=guard.file_changes(original,r.files.inventory(restored),allowed)
    r.files.equal(original,r.files.inventory(point/'source-point-private'))
    services.stop_stack(DATABASE,storage,OUT/'api-kong-runtime-private.json',OUT,state,r.record['serviceStops'])
    clients=int(database.archive.sql(DB_ID,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'",DATABASE));resume_guards.quiescent(clients)
    database.image.CONTAINER=DB_ID;database.image.OUT=OUT
    actual=database.image.inventory(DATABASE,'separate-api-final')
    baseline=json.loads((point/'original-before-inventory-private.json').read_text())
    source=(ROLE/'source-continuation-schema-private.log').read_text()
    source_sha=hashlib.sha256('\n'.join(line for line in source.splitlines() if not line.startswith(('--','\\restrict ','\\unrestrict '))).encode()).hexdigest()
    resume_guards.native_records(source_sha,baseline,actual)
    target=subprocess.check_output(['docker','exec',DB_ID,'pg_dump','-U','supabase_admin','-d',DATABASE,'--schema-only'],stderr=subprocess.PIPE,timeout=120).decode()
    (OUT/'final-schema-private.log').write_text(target)
    observed=schema.verify(source,target,json.loads((ROLE/'source-catalog-private.json').read_text()),json.loads(database.archive.sql(DB_ID,schema.CATALOG_QUERY,DATABASE)))
    database.g.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),database.archive.database_properties(DB_ID,DATABASE))
    roles=subprocess.check_output(['docker','exec',DB_ID,'pg_dumpall','-U','supabase_admin','--roles-only'],stderr=subprocess.PIPE,timeout=60).decode()
    (OUT/'final-roles-private.log').write_text(roles)
    database.g.verify_roles(json.loads((protected/'roles-inventory-private.json').read_text()),json.loads(database.archive.role_inventory(DB_ID)),(protected/'roles-private.sql').read_text(),roles)
    database.archive._keys.require_mounted_bytes(receipt,database.archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
    n.verify_database_attachment(services.inspect(DB_ID),receipt,database.VOLUME,ROLE/'mounted-root-private.key',database.g.verify_container,True)
    subprocess.run(['docker','stop','--time','10',DB_ID],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=20)
    final=services.inspect(DB_ID)
    n.verify_database_attachment(final,receipt,database.VOLUME,ROLE/'mounted-root-private.key',database.g.verify_container,True)
    r.s.require(not final['State']['Running'],'expanded-stack-survived-stop')
    r.record.update(state='passed-separate-cluster-native-api',wallSeconds=round(time.monotonic()-started,3),tables=len(actual['tables']),sequences=len(actual['sequences']),storageObjects=10,changedFiles=changes,schema=observed,roleAttributesPasswordsAndGrantsEqual=True,mountedKeyBytesEqual=True,databaseStopped=True,scope='Separate cluster and volume on the same host/disk. Private bridge API only. No browser, external host, historical decryption, model validation or all-worker recovery acceptance.')
    r.save();(OUT/'result.json').write_text(json.dumps(r.record,indent=2)+'\n')
    print(json.dumps({'state':r.record['state'],'tables':len(actual['tables']),'storageObjects':10,'wallSeconds':r.record['wallSeconds']}),flush=True)

if __name__=='__main__':main()
