"""Summarize retained scope telemetry and modeled-output custody."""
import hashlib
import json
from pathlib import Path
import re

E=Path(__file__).resolve().parent
R=Path('/home/nathaniel/.local/state/openplan/tbi2019-full-multiprocess-20261024')


def digest(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()


def group(stage,name):
    if 'coalesce' in stage or 'coalesce' in name: return 'coalesce'
    if 'apportion' in stage or 'apportion' in name: return 'apportion'
    for key,label in [('initialize_landuse','land_use_initialization'),('initialize_households','household_initialization'),('compute_accessibility','accessibility'),('school_location','school_location'),('workplace_location','workplace_location'),('trip_scheduling','trip_scheduling'),('trip_mode_choice','trip_mode_choice')]:
        if key in stage: return label
    return 'other_model_steps' if stage!='startup' else 'startup'


def main():
    runs=[]
    for path in sorted(R.glob('fullmp4-*.run.json')):
        name=path.name.removesuffix('.run.json'); record=json.loads(path.read_text())
        health=R/(name+'.health.json'); record['scope_health']=json.loads(health.read_text()) if health.exists() else None
        external=R/(name+'.external.jsonl')
        record['external_terminal']=json.loads(external.read_text().splitlines()[-1]) if external.exists() else None
        processes={}; stage_groups={}
        samples=R/(name+'.memory.jsonl')
        if samples.exists():
            for line in samples.open():
                sample=json.loads(line); active=set()
                for pid,p in sample['processes'].items():
                    label=group(p['stage'],p['name'])
                    if p['name'] != 'unlabelled' and p['name'] != 'MainProcess':
                        active.add(label)
                    row=processes.setdefault(pid,{'name':p['name'],'rss_peak_bytes':0,'observed_vmhwm_bytes':0,'stages':{}})
                    if p['name']!='unlabelled': row['name']=p['name']
                    row['rss_peak_bytes']=max(row['rss_peak_bytes'],p.get('VmRSS',0)*1024)
                    row['observed_vmhwm_bytes']=max(row['observed_vmhwm_bytes'],p.get('VmHWM',0)*1024)
                    row['stages'][label]=max(row['stages'].get(label,0),p.get('VmRSS',0)*1024)
                for label in active:
                    stage_groups[label]=max(stage_groups.get(label,0),int(sample['memory.current']))
        record['processes']=processes; record['stage_group_sampled_cgroup_peaks_bytes']=stage_groups
        log=R/(name+'.engine.log')
        record['last_engine_lines']=log.read_text().splitlines()[-12:] if log.exists() else []
        runs.append({'name':name,**record})
    result={'outcomes_accessed':False,'status':json.loads((R/'status.json').read_text()),'runs':runs,
        'measurement_limits':'One-second RSS/stage samples are lower bounds. Observed VmHWM can miss terminal peaks. RSS overlaps shared pages. Each stage cgroup peak is aggregate while at least one process has that label, not isolated stage allocation. Kernel lifetime peak is separate; external last counters may precede removal.',
        'full_outputs':{a:{'hashes':{p.name:digest(p) for p in (R/('full-'+a)).glob('final_*.csv')},'tours':None,'trips':None,'mode_shares_MODELED':None,'strata_MODELED':None} for a in ['current','semcog']}}
    (E/'run-health.json').write_text(json.dumps(result,indent=2)+'\n')
    for name in ['freeze.json','preflight.json','current-comparison.json','semcog-comparison.json']:
        if (R/name).exists():
            (E/name).write_bytes((R/name).read_bytes())
    print(json.dumps([{'name':x['name'],'exit':x['exit_code'],'elapsed':x['elapsed_seconds'],'scope':x['scope_health'],'external':x['external_terminal']} for x in runs],indent=2))


if __name__=='__main__': main()
