"""Summarize cgroup stage groups, clearly separating sampled and lifetime peaks."""
import json
from pathlib import Path
import re

E=Path(__file__).resolve().parent
result=[]
for path in sorted(E.glob('*.memory.jsonl')):
    groups={}; last='startup'
    for line in path.open():
        row=json.loads(line)
        label=row['stage']
        match=re.search(r'(initialize_landuse|initialize_households|compute_accessibility|school_location|workplace_location|auto_ownership|free_parking|cdap|mandatory_tour|joint_tour|non_mandatory_tour|tour_mode_choice|atwork_subtour|stop_frequency|trip_purpose|trip_destination|trip_scheduling|trip_mode_choice|write_tables|write_data_dictionary)',label)
        if match: last=match.group(1)
        group=groups.setdefault(last,{'first_sample_seconds':row['elapsed_seconds'],'last_sample_seconds':0,'sampled_cgroup_peak_bytes':0,'sampled_process_rss_peak_bytes':None,'sampled_anon_peak_bytes':0,'sampled_file_peak_bytes':0,'samples':0})
        group['last_sample_seconds']=row['elapsed_seconds'];group['samples']+=1
        group['sampled_cgroup_peak_bytes']=max(group['sampled_cgroup_peak_bytes'],int(row['memory.current']))
        stat=dict(x.split() for x in row['memory.stat'].splitlines())
        for field in ['anon','file']:
            key='sampled_'+field+'_peak_bytes';group[key]=max(group[key],int(stat[field]))
        rss=row.get('process_memory_kib',{}).get('VmRSS')
        if rss is not None:group['sampled_process_rss_peak_bytes']=max(group['sampled_process_rss_peak_bytes'] or 0,rss*1024)
    name=path.name.removesuffix('.memory.jsonl')
    health=E/(name+'.health.json');run=E/(name+'.run.json')
    result.append({'name':name,'scope_health':json.loads(health.read_text()) if health.exists() else None,
        'run':json.loads(run.read_text()) if run.exists() else None,'stage_groups_sampled':groups})
(E/'stage-memory-summary.json').write_text(json.dumps({'runs':result,
    'limits':'Stage-group peaks sample memory.current every second. They are lower bounds, not exact stage maxima. Separate prefix and suffix lifetime peaks use cgroup memory.peak. RSS and file cache overlap with cgroup memory. The original diagnostic/training monitor can attribute generic chunk samples to the preceding named stage.'},indent=2)+'\n')
