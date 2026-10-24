"""Report measured allocations; file cache, resident memory, and table bytes overlap."""
import json
from pathlib import Path

E=Path(__file__).resolve().parent
rows=[json.loads(line) for line in (E/'profile-20000.memory.jsonl').read_text().splitlines()]
trace=[json.loads(line) for line in (E/'profile-20000.profile.jsonl').read_text().splitlines()]
peak=max(rows,key=lambda r:int(r['memory.current']))
stat={k:int(v) for k,v in (line.split() for line in peak['memory.stat'].splitlines())}
grade=[r for r in trace if 'gradeschool' in r['label']]
result={'outcomes_accessed':False,'scope_health':json.loads((E/'profile-20000.health.json').read_text()),
        'skim_storage':{'matrices':826,'dtype':'float32','shape':[826,634,634],'file_backed_bytes':826*634*634*4,
                        'factory':'MemMapSkimFactory / JitMemMapSkimData','loading':'All 826 matrices copied into file cache; each lookup maps and closes on demand. No persistent 826-matrix heap array.',
                        'filter_support':'v1.5.1 SkimInfo filters unconfigured period labels only; all five configured periods remain required. No configured-variable matrix selector found. No skim setting or bytes changed.'},
        'sampled_peak':{'elapsed_seconds':peak['elapsed_seconds'],'cgroup_current':int(peak['memory.current']),
                        'anon':stat['anon'],'file':stat['file'],'kernel':stat.get('kernel'),'stage':peak['stage']},
        'grade_school':grade,
        'limits':'One-second cgroup samples miss shorter peaks; memory.peak and ru_maxrss retain lifetime maxima. Table deep bytes may count shared objects more than once; do not sum with process or cgroup memory. Call/return RSS is not per-chunk peak.'}
for variant in ['reduced', 'allocator']:
    stem='profile-20000-'+variant
    records=[json.loads(line) for line in (E/(stem+'.profile.jsonl')).read_text().splitlines()]
    grade=[row for row in records if 'gradeschool' in row['label']]
    functions={}
    for row in grade:
        if row['event']!='return':continue
        item=functions.setdefault(row['function'],{'max_boundary_rss_bytes':0,'max_local_table_bytes':{},'max_array_bytes':{}})
        item['max_boundary_rss_bytes']=max(item['max_boundary_rss_bytes'],row['rss_bytes'])
        for key,table in row['local_tables'].items():
            item['max_local_table_bytes'][key]=max(item['max_local_table_bytes'].get(key,0),table['bytes_deep'])
        for key,array in row.get('arrays',{}).items():
            item['max_array_bytes'][key]=max(item['max_array_bytes'].get(key,0),array['bytes'])
    result[variant+'_target_diagnostic']={'chunk_size':268435456,
        'scope_health':json.loads((E/(stem+'.health.json')).read_text()),
        'grade_school_logsum_chunks':sum(row['function']=='_simple_simulate_logsums' and row['event']=='call' for row in grade),
        'max_grade_school_rows_per_chunk':max(row['local_tables']['choosers']['rows'] for row in grade if row['function']=='_simple_simulate_logsums' and row['event']=='call'),
        'functions':functions}
(E/'memory-breakdown.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='grade_school'},indent=2))
