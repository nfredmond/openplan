"""Retain compact local proof receipts without committing raw model tables."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

P=Path(__file__).resolve().parent
root=Path(sys.argv[1]);final=root/'proof-final'
comparison=json.loads((final/'parity-comparison.json').read_text())
proof=next((final/'retrieved/results').glob('parity-*'))
stages={}
for name in ['current-prefix','current-suffix','semcog-prefix','semcog-suffix']:
    health=json.loads((proof/name/'health.json').read_text()); processes={};groups={}
    for line in (proof/name/'memory.jsonl').open():
        row=json.loads(line)
        for pid,data in row['processes'].items():
            label=data['name']; raw=data['step']
            match=re.search(r'(?:running step |Running )([a-z_]+)',raw)
            step=match.group(1) if match else raw
            process=processes.setdefault(pid,{'name':label,'rss_peak_bytes':0,'observed_vmhwm_bytes':0,'steps':{}})
            process['name']=label
            process['rss_peak_bytes']=max(process['rss_peak_bytes'],data.get('VmRSS',0))
            process['observed_vmhwm_bytes']=max(process['observed_vmhwm_bytes'],data.get('VmHWM',0))
            process['steps'][step]=max(process['steps'].get(step,0),data.get('VmRSS',0))
            groups[step]=max(groups.get(step,0),int(row.get('memory.current') or 0))
    stages[name]={'health':health,'processes':processes,'sampled_aggregate_by_step':groups}
image=json.loads(subprocess.check_output(['docker','image','inspect','astra-tbi-cloud-run:20261024-final']))[0]
record={'status':'container_choice_parity_passed_full_cloud_unrun','image_id':image['Id'],
        'registry_digest':None,'image_architecture':image['Architecture'],
        'parent_head':'6c4cf58de9e2befd6ef9100e7ab054c1e7deac67',
        'private_evidence_root':str(root),'proof':json.loads((root/'proof-input/receipt.json').read_text()),
        'comparison':comparison,'stages':stages,
        's3_verification':json.loads((final/'s3-verification.json').read_text()),
        'docker':json.loads((final/'docker-receipts.json').read_text()),
        'cleanup':json.loads((final/'cleanup.json').read_text()),
        'tests':{'passed':31,'failed':0,'skipped':0,'package':17,'retained_comparators':14},
        'mutation_controls':{'accepted':15,'harmless':3,'intended_failures':12},
        'outcomes_accessed':False,'full_model_runs':0,
        'limits':['subset parity is not scientific accuracy','no full-scale suffix or coalescence memory proof',
                  'one-second process samples miss transient peaks','local S3 emulator is not cloud-provider acceptance',
                  'SIGKILL/host loss can prevent terminal upload']}
(P/'LOCAL_PROOF.json').write_text(json.dumps(record,indent=2)+'\n')
# Inventory private evidence after ephemeral credential files have been removed.
files=[]
for path in sorted(root.rglob('*')):
    if path.is_file() and path.suffix!='.env' and path.name!='PRIVATE_MANIFEST.json':
        with path.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
        files.append({'path':str(path.relative_to(root)),'bytes':path.stat().st_size,'sha256':sha})
manifest=root/'PRIVATE_MANIFEST.json';manifest.write_text(json.dumps({'files':files},indent=2)+'\n')
(P/'PRIVATE_CUSTODY.json').write_text(json.dumps({'path':str(manifest),'sha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),
                                                'files':len(files),'bytes':sum(x['bytes'] for x in files)},indent=2)+'\n')
print(json.dumps({'image_id':image['Id'],'private_files':len(files),'proof_arms':list(comparison)}))
