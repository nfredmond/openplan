"""Restart only verified new fixture IDs and observe bounded readiness requests."""
import json, os, subprocess, time
from pathlib import Path
import requests
import services as s

p=Path(__file__).parent
state=json.loads((p/'api-service-receipts-private.json').read_text())
storage=p.parent/'separate-cluster-point-20261011-02/restored-private'/Path(str(p.parent/'transit-expanded-local-point-20261011-03/source-point-private')).relative_to('/')/'storage-objects'
configuration=p/'api-kong-runtime-private.json'

def main():
    os.umask(0o077)
    for kind,receipt in state['services'].items():
        s.verify_new(kind,s.inspect(receipt['id']),receipt,state['database'],storage,configuration)
        subprocess.run(['docker','start',receipt['id']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
    session=requests.Session();session.trust_env=False
    gateway=s.inspect(state['services']['gateway']['id'])
    address=gateway['NetworkSettings']['Networks'][s.NETWORK]['IPAddress']
    records=[]
    try:
        for cycle in range(3):
            for origin in (s.API,'http://'+address+':8000'):
                for path in ('/auth/v1/health','/rest/v1/gtfs_feed_versions?select=id&limit=0','/storage/v1/status'):
                    key=state['service_key']
                    try:
                        with session.get(origin+path,headers={'apikey':key,'Authorization':'Bearer '+key},timeout=2) as response:
                            result={'status':response.status_code}
                    except requests.RequestException as error:result={'errorType':type(error).__name__}
                    records.append({'cycle':cycle,'origin':origin,'path':path,**result})
            time.sleep(1)
    finally:
        (p/'readiness-diagnostics.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(records),flush=True)

if __name__=='__main__':main()
