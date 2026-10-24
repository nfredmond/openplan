"""Report completed run status and sampled resources without survey access."""
from collections import deque
import hashlib
import json
from pathlib import Path
import re

E=Path(__file__).resolve().parent
R=Path('/home/nathaniel/.local/state/openplan/tbi2019-full16-20261024')

def digest(p):
    with p.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    records=json.loads((R/'full-runs.json').read_text())
    stages=[]
    for path in sorted(R.glob('*.memory.jsonl')):
        groups={};last='startup'
        for line in path.open():
            row=json.loads(line)
            match=re.search(r'(initialize_landuse|initialize_households|compute_accessibility|school_location|workplace_location|auto_ownership|free_parking|cdap|mandatory_tour|joint_tour|non_mandatory_tour|tour_mode_choice|atwork_subtour|stop_frequency|trip_purpose|trip_destination|trip_scheduling|trip_mode_choice|write_tables|write_data_dictionary)',row['stage'])
            if match:last=match.group(1)
            group=groups.setdefault(last,{'first_sample_seconds':row['elapsed_seconds'],'last_sample_seconds':0,'sampled_cgroup_peak_bytes':0,'samples':0})
            group['last_sample_seconds']=row['elapsed_seconds'];group['samples']+=1
            group['sampled_cgroup_peak_bytes']=max(group['sampled_cgroup_peak_bytes'],int(row['memory.current']))
        name=path.name.removesuffix('.memory.jsonl')
        health=R/(name+'.health.json');run=R/(name+'.run.json');external=R/(name+'.external.jsonl')
        events=[json.loads(x) for x in external.read_text().splitlines()] if external.exists() else []
        terminal=events[-1] if events else None
        log=R/(name+'.engine.log')
        if log.exists():
            with log.open() as stream:tail=[line.rstrip() for line in deque(stream,maxlen=12)]
        else:tail=[]
        stages.append({'name':name,'scope_health':json.loads(health.read_text()) if health.exists() else None,
            'run':json.loads(run.read_text()) if run.exists() else None,'external_observer_terminal':terminal,
            'stage_groups_sampled':groups,'last_engine_lines':tail})
    result={'claim':'MODELED run health only; no scientific acceptance','outcomes_accessed':False,
        'private_root':str(R),'full_population':{'households':1060601,'persons':2617177,'zones':634},
        'arms':records,'stages':stages,
        'resource_limits':'Stage-group memory.current peaks use one-second samples and are lower bounds. Scope health memory.peak is a kernel lifetime peak. External terminal records retain the last observed counters before cgroup removal; they may miss later events.'}
    (E/'run-health.json').write_text(json.dumps(result,indent=2)+'\n')
    inventory=[]
    for p in sorted(R.rglob('*')):
        if p.is_file():inventory.append({'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':digest(p)})
    (E/'OUTPUT_MANIFEST.json').write_text('{\n  "private_root": '+json.dumps(str(R))+',\n  "files": [\n'+',\n'.join('    '+json.dumps(x) for x in inventory)+'\n  ]\n}\n')
    print(json.dumps({'arms':records,'private_files':len(inventory),'private_bytes':sum(x['bytes'] for x in inventory),'manifest_sha256':digest(E/'OUTPUT_MANIFEST.json')}))

if __name__=='__main__':main()
