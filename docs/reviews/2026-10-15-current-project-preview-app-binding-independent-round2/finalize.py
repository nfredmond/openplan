"""Compare replay outcomes and screen only known secret values before publication."""
import json
import os
import subprocess
from common import HERE, OUT, V2, FROZEN, PUBLIC, sha, write

os.umask(0o077)
def read(path):
    return json.loads(path.read_bytes())

supplied = read(PUBLIC/'evidence.json')
controls = read(OUT/'controls-baseline-05.json')
restored = read(OUT/'controls-restored-05.json')
assert controls == restored
assert json.dumps(controls).replace(str(OUT),str(V2)) == json.dumps(supplied['consumerControls'])
mutations = read(OUT/'mutations-05.json')
assert mutations == supplied['consumerMutations']
attestation = read(OUT/'attestation-controls-01.json')
assert attestation == supplied['attestation']
small = read(OUT/'small-guard-controls-01.json')
assert small['cases'] == supplied['smallGuards']['cases']
assert small['mutations'] == supplied['smallGuards']['mutations']
assert small['actualPythonCgroup']['memory.max'] == '536870912'
assert small['actualPythonCgroup']['memory.swap.max'] == '0'
assert small['actualPythonCgroup']['cpu.max'] == '50000 100000'
producer = read(OUT/'actual-health-producer.json')
assert producer['sourceHashes'] == supplied['producer']['sourceHashes']
assert producer['mutations'] == supplied['producer']['mutations']
assert producer['baseline']['payload']['deployment'] == supplied['producer']['baseline']['payload']['deployment']
composition = read(OUT/'composed-controls-07.json')
fields = ['case','phase','outcome','reason','childCount','observed']
project = lambda rows: [{k:r[k] for k in fields if k in r} for r in rows]
assert project(composition['cases']) == project(supplied['composition']['cases'])
assert composition['recipeSha256'] == supplied['composition']['recipeSha256']
assert len(composition['cases']) == 26 and composition['restored']
boundary = read(OUT/'boundary-controls-02.json')
assert json.dumps(boundary).replace(str(OUT),str(V2)) == json.dumps(supplied['boundary'])
entry = read(OUT/'entry-controls-01.json')
assert len(entry['cases']) == 9 and entry['restored']
guards = read(OUT/'retained-guard-controls-01.json')
assert len(guards['cases']) == 7 and guards['restored']
preservation = read(OUT/'preservation-result.json')
assert preservation['unchanged']
units = ['before-01','direction-01','prepare-01','attestation-01','consumer-01','small-01',
         'boundary-01','composition-01','entry-controller-01','guards-01','audit-01','after-01']
journals = {}
for unit in units:
    result = subprocess.run(['/usr/bin/journalctl','--user','-u','openplan-review-r2-'+unit+'.service','--no-pager','-o','json'],
                            capture_output=True, check=True, timeout=10)
    journals[unit] = [json.loads(line) for line in result.stdout.splitlines()]
write(OUT/'unit-journals-private.json', journals)
values = read(V2/'app-env-private.json')
secrets = [value.encode() for key,value in values.items() if isinstance(value,str) and len(value)>=8 and
           key in ['CENSUS_API_KEY','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','OPENPLAN_INTEGRATION_KEY_SECRET','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']]
for env in read(FROZEN/'envs-private.json').values():
    for key,value in env.items():
        if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):
            secrets.append(value.encode())
secrets = list(set(secrets))
scan = lambda data: any(secret in data for secret in secrets)
aggregate = b'\n'.join(p.read_bytes() for p in HERE.rglob('*') if p.is_file())
assert not scan(aggregate+b'\nHarmless note.\n')
assert all(scan(aggregate+b'\n'+secret) for secret in secrets)
artifacts = ['input-audit-01.json','controls-baseline-05.json','controls-restored-05.json','mutations-05.json',
             'attestation-controls-01.json','actual-health-producer.json','small-guard-controls-01.json',
             'boundary-controls-02.json','composed-controls-07.json','entry-controls-01.json','retained-guard-controls-01.json',
             'preservation-before-private.json','preservation-after-private.json','preservation-result.json',
             'preservation-assay.json','unit-journals-private.json']
evidence = {
    'reviewedCommit':'807c89b29692e1e56ae1d8e3d34714480e72ede7',
    'verdict':'No unresolved P1/P2 finding in this bounded operating recipe review. No application execution acceptance.',
    'disposition':{'priorF1':'cleared at the payload boundary','R1':'cleared for the composed stand-in recipe','R2':'cleared for actual source producer and real attestor with replaced acquisition'},
    'consumer':{'cases':len(controls),'refusals':sum(x['outcome']=='refused' for x in controls),'mutations':mutations,'restored':True},
    'attestation':attestation, 'producer':producer,
    'composition':composition, 'singleBoundary':boundary, 'singleWrapperEntry':entry,
    'small':small, 'retainedGuards':guards, 'inputAudit':read(OUT/'input-audit-01.json'), 'preservation':preservation,
    'privacy':{'knownUniqueValues':len(secrets),'harmlessSurvives':True,'eachInjectionDetected':True,
               'blindCategory':'Unknown secrets, short identifiers and external/future files.'},
    'privateEvidenceHashes':{name:sha(OUT/name) for name in artifacts},
    'scriptHashes':{p.name:sha(p) for p in sorted(HERE.iterdir()) if p.suffix in ['.py','.sh']},
    'limits':['No actual application checkout/build/npm/start/listener or live attestation.',
              'No helper/REST/SQL/HTTP/provider/browser operation, install, full QA, nested delegation, push, PR or main merge.',
              'Controllers are trusted code with ordinary user filesystem and Docker permissions.',
              'No logical source/global/Storage preservation, actual build capacity, native artifact, visual or human acceptance.'],
    'applicationExecutionAccepted':False,
}
assert not scan(json.dumps(evidence).encode())
write(OUT/'evidence-public.json', evidence)
print(json.dumps({'consumerCases':len(controls),'startupCases':len(attestation['cases']),
                  'compositionObservations':26,'entryObservations':9,'knownValueControls':len(secrets),
                  'oldAndV2FilesUnchanged':True,'applicationExecutionAccepted':False}))
