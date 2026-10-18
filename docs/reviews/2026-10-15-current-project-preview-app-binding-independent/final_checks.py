"""Compare reproduced rows and screen public output without printing secrets."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess

PUBLIC=Path(__file__).resolve().parent
ORIGINAL_PUBLIC=PUBLIC.parent/'2026-10-15-current-project-preview-app-binding'
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')
ORIGINAL=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
FROZEN=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')

def read(path):return json.loads(path.read_bytes())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def normalize(value):
    return json.loads(json.dumps(value).replace(str(ROOT),str(ORIGINAL)).replace('boundary-specimens-03','boundary-specimens-02'))

def main():
    os.umask(0o077)
    for name in ['controls-baseline-05.json','controls-restored-05.json','mutations-05.json',
                 'attestation-controls-01.json','boundary-controls-02.json']:
        assert normalize(read(ROOT/name))==read(ORIGINAL/name),name+':replay-difference'
    small=read(ROOT/'small-guard-controls-01.json');old=read(ORIGINAL/'small-guard-controls-01.json')
    assert normalize(small['cases'])==old['cases'] and normalize(small['mutations'])==old['mutations'] and small['restored']
    c=small['actualPythonCgroup']
    assert c['memory.max']=='536870912' and c['memory.swap.max']=='0' and c['memory.swap.current']=='0' and c['cpu.max']=='50000 100000'
    assert not (ORIGINAL/'candidate').exists() and not list((ORIGINAL/'execution').iterdir())
    inputs=read(ORIGINAL_PUBLIC/'manifest.json')
    assert sha(ORIGINAL/'binding-private.json')==inputs['bindingSha256']
    assert all(sha(ORIGINAL/name)==h for name,h in inputs['privateInputs'].items())
    values=read(ORIGINAL/'app-env-private.json');secrets=[]
    for key in ['CENSUS_API_KEY','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','OPENPLAN_INTEGRATION_KEY_SECRET',
                'SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']:
        if key in values and len(values[key])>=8:secrets.append(values[key].encode())
    for env in read(FROZEN/'envs-private.json').values():
        for key,value in env.items():
            if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):
                secrets.append(value.encode())
    secrets=list(set(secrets))
    aggregate=b'\n'.join(p.read_bytes() for p in PUBLIC.rglob('*') if p.is_file())
    def scan(data):return any(x in data for x in secrets)
    assert not scan(aggregate) and not scan(aggregate+b'\nHarmless review note.\n')
    assert all(scan(aggregate+b'\n'+x) for x in secrets)
    for path in PUBLIC.glob('*.py'):ast.parse(path.read_bytes())
    units=['inventory-01','consumer-01','consumer-02','attestation-01','probes-01','nested-boundary-01',
           'direct-boundary-01','direct-boundary-02','health-01','health-02','direction-01',
           'nested-02','inventory-assay-01','inventory-02']
    journals={}
    for name in units:
        result=subprocess.run(['/usr/bin/journalctl','--user','-u','openplan-app-independent-'+name+'.service',
                               '--no-pager','-o','json'],capture_output=True,check=True,timeout=10)
        journals[name]=[json.loads(line) for line in result.stdout.splitlines()]
    with (ROOT/'unit-journals-private.json').open('x') as f:json.dump(journals,f)
    before=read(ROOT/'preservation-before-private.json');after=read(ROOT/'preservation-after-private.json')
    assert before==after
    result={'reviewedCommit':'f29968d67c8177f33122691ad5879c675d457e08',
            'verdict':'Two P2 findings block the unchanged execution recipe. No P1 identified.',
            'consumer':{'cases':47,'refusals':43,'mutations':14,'harmlessSurvivors':1,'restored':True},
            'attestation':{'cases':16,'mutations':6,'harmlessSurvivors':1,'restored':True},
            'small':{'cases':7,'mutations':4,'harmlessSurvivors':1,'restored':True,'actualPythonCgroup':c},
            'suppliedSingleBoundary':{'observations':5,'faults':2,'restored':True},
            'independentSingleBoundary':read(ROOT/'independent-boundary-02.json'),
            'healthProbe':read(ROOT/'health-probe-02.json'),
            'nestedProbe':read(ROOT/'nested-constructor-01.json'),
            'preservation':{k:{'entries':len(v),'filesAndLinks':sum('directory' not in x for x in v.values()),'unchanged':True} for k,v in before.items()},
            'privacy':{'knownUniqueValues':len(secrets),'harmlessSurvives':True,'eachInjectionDetected':True,
                       'blindCategory':'Unknown secrets, short identifiers and external/future files.'},
            'privateEvidenceHashes':{name:sha(ROOT/name) for name in ['input-audit-01.json','controls-baseline-05.json',
                'controls-restored-05.json','mutations-05.json','attestation-controls-01.json',
                'boundary-controls-02.json','small-guard-controls-01.json','independent-boundary-02.json',
                'health-probe-02.json','nested-constructor-01.json','preservation-before-private.json',
                'preservation-after-private.json','preservation-assay-01.json','unit-journals-private.json']},
            'prohibitedOperations':'No application checkout/build/start, helper operation, DB query/write, provider/HTTP call, install, browser, full suite, nested agent, push, PR or main merge.',
            'applicationExecutionAccepted':False}
    encoded=(json.dumps(result,indent=2)+'\n').encode()
    assert not scan(encoded)
    with (ROOT/'final-check-01.json').open('xb') as f:f.write(encoded)
    print(json.dumps({'suppliedRowsMatch':True,'frozenPacketsUnchanged':True,'privacyKnownValues':len(secrets),'verdict':'two P2 findings'}))

if __name__=='__main__':main()
