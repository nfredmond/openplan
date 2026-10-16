"""Retain private unit journals and emit a checked, sanitized public packet copy."""
import ast
import json
import os
from pathlib import Path
import subprocess
from common import PUBLIC,ROOT,FROZEN,sha,read,write

os.umask(0o077)
out=ROOT/'public-output-final-02';out.mkdir(mode=0o700)
manifest=read(ROOT/'public-output-01/manifest.json')
evidence=read(ROOT/'public-output-01/evidence.json')
units=[]
for stage,attempt,exit_code in [('prepare','01',0),('direction','01',0),('controls','01',0),('attestation','01',0),
    ('identity','01',0),('composition','01',0),('mechanical','01',0),('entry','01',0),('seal','01',1),('seal','02',0)]:
    unit=f'openplan-binding-v3-{stage}-{attempt}.service'
    raw=subprocess.check_output(['/usr/bin/journalctl','--user','-u',unit,'--no-pager','-o','json'])
    rows=[json.loads(line) for line in raw.splitlines()]
    assert rows and any(row.get('JOB_RESULT')=='done' for row in rows),'unit-start-record:'+unit
    path=ROOT/f'journal-{stage}-{attempt}-final02-private.json';write(path,rows)
    account=next((row for row in rows if 'MEMORY_PEAK' in row),None)
    if account is not None:
        assert account['MEMORY_SWAP_PEAK']=='0'
        assert int(account['MEMORY_PEAK'])<=512*1024**2
    units.append({'unit':unit,'configured':{'MemoryMax':'512M','MemorySwapMax':'0','CPUQuota':'50%'},
        'terminalExitCodeObservedByAgent':exit_code,
        'journalAccounting':None if account is None else {key:account[key] for key in ['CPU_USAGE_NSEC','MEMORY_PEAK','MEMORY_SWAP_PEAK']},
        'privateJournalSha256':sha(path)})
# Final source hashes include this reporting script. No runtime source changes.
evidence['scriptHashes']={str(path.relative_to(PUBLIC)):sha(path) for path in sorted(PUBLIC.rglob('*'))
    if path.is_file() and path.suffix in ['.py','.sh','.cjs']}
evidence['preFinalSealOutputHashes']={name:sha(ROOT/'public-output-01'/name) for name in ['manifest.json','evidence.json']}
evidence['retainedFinalizationFailure']=read(ROOT/'finalize-failed-01.json')
evidence['privateArtifactHashes'].update({name:sha(ROOT/name) for name in ['finalize-failed-01.py','finalize-failed-01.json']})
evidence['unitAccountingBoundary']='Short units can omit journal resource summaries; missing values stay null. Configured caps and retained journal accounting; terminal exits are observed from the tool results, not inferred from a systemd start request.'
secret_values=[]
values=read(ROOT/'app-env-private.json')
for key in ['CENSUS_API_KEY','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','OPENPLAN_INTEGRATION_KEY_SECRET','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY']:
    if key in values and len(values[key])>=8:secret_values.append(values[key].encode())
for env in read(FROZEN/'envs-private.json').values():
    for key,value in env.items():
        if isinstance(value,str) and len(value)>=16 and ('SECRET' in key or key.endswith('_KEY') or value.startswith('postgresql://')):secret_values.append(value.encode())
for value in [manifest,evidence,units]:
    encoded=json.dumps(value).encode();assert not any(secret in encoded for secret in secret_values)
for name,value in [('manifest.json',manifest),('evidence.json',evidence),('execution.json',units)]:write(out/name,value)
# This script only writes private output. The parent process copies reviewed public records.
print(json.dumps({'recordsReady':True,'units':len(units),'retainedReportingFailures':2,'applicationStages':0}))
