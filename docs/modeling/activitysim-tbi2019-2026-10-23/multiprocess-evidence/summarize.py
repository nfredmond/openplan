"""Retain resource measurements and hashes without reading survey outcomes."""
import hashlib
import json
from pathlib import Path

R=Path('/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024')
E=Path(__file__).resolve().parent


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def main():
    runs=[]
    for health_path in sorted(R.glob('mp4*.health.json')):
        name=health_path.name.removesuffix('.health.json')
        health=json.loads(health_path.read_text()); run=json.loads((R/(name+'.run.json')).read_text())
        processes={}
        for line in (R/(name+'.memory.jsonl')).read_text().splitlines():
            sample=json.loads(line)
            for pid,row in sample['processes'].items():
                record=processes.setdefault(pid,{'pid':int(pid),'name':'unlabelled','sampled_rss_peak_bytes':0,'observed_vmhwm_bytes':0})
                if row['name']!='unlabelled': record['name']=row['name']
                record['sampled_rss_peak_bytes']=max(record['sampled_rss_peak_bytes'],row.get('VmRSS',0)*1024)
                record['observed_vmhwm_bytes']=max(record['observed_vmhwm_bytes'],row.get('VmHWM',0)*1024)
        runs.append({'name':name,'outer_elapsed_seconds':run['elapsed_seconds'],**health,'processes':list(processes.values()),
            'measurement_limits':'One-second per-PID observations can miss terminal peaks. VmHWM is the kernel lifetime high-water mark observed at sampling time. RSS includes shared pages; summed RSS is not cgroup memory. The monitor stage label recognizes some Running messages but misses #run_model boundaries, so no stage-group acceptance derives from it.'})
    output=R/'parity-current-r3'
    summary={'runs':runs,'parity':{'current':'failed_exact_parity_six_logsum_cells','semcog':'not_run_after_current_failure'},
        'full':{a:{'status':'not_run_after_parity_failure','households':1060601,'persons':2617177,'zones':634,'tours':None,'trips':None,'mode_shares_MODELED':None,'strata_MODELED':None,'final_hashes':{}} for a in ['current','semcog']},
        'subset_counts':{'households':2000,'persons':4971,'zones':634,'tours':6763,'trips':17377,'joint_participants':274},
        'completed_current_subset_hashes':{p.name:digest(p) for p in sorted(output.glob('final_*.csv'))},
        'outcomes_accessed':False,'no_further_engine_run_after_numeric_failure':True}
    (R/'run-health.json').write_text(json.dumps(summary,indent=2)+'\n')
    before=json.loads((R/'engine-before.json').read_text())
    preservation={'files_checked':len(before),'all_hashes_unchanged':all(digest(Path(p))==h for p,h in before.items()),'files':before}
    (R/'engine-preservation.json').write_text(json.dumps(preservation,indent=2)+'\n')
    print(json.dumps({'runs':[{'name':r['name'],'elapsed':r['outer_elapsed_seconds'],'peak':r['scope']['memory.peak'],'exit_code':r['exit_code']} for r in runs],
        'current_workers':[p for r in runs if r['name']=='mp4-r3-current-prefix' for p in r['processes'] if p['name'].startswith('mp_households_')],
        'hashes':summary['completed_current_subset_hashes'],'engine_preserved':preservation['all_hashes_unchanged']},indent=2))


if __name__=='__main__':
    main()
