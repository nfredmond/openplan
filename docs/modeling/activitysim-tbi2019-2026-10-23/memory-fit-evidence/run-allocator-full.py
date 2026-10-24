"""Complete each retained-population hybrid arm sequentially, with no outcome access."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from prepare import m, E, config, PREFIX
from execute import run
from admission import admit_full, verify_chunking


def main():
    cache=admit_full('allocator-parity-result.json','alloc-2000-')
    m.save('allocator-full-before-run.json',{'households':1060601,'persons':2617177,'zones':634,
        'allocator_environment':{'MALLOC_MMAP_THRESHOLD_':'131072','MALLOC_TRIM_THRESHOLD_':'0','MALLOC_ARENA_MAX':'2'},'prefix_chunk_size':268435456,'prefix_mode':'production','min_available_chunk_ratio':0.05,
        'suffix_chunk_size':0,'suffix_mode':'disabled','cache_sha256':m.digest(cache),
        'outcomes_accessed':False,'scientific_acceptance':False})
    records=[]
    for arm in ['current','semcog']:
        name='alloc-full-'+arm; output=m.R/name; output.mkdir(); (output/'cache').mkdir()
        shutil.copyfile(cache,output/'cache/chunk_cache.csv')
        record={'arm':arm,'completion':'not_complete','output':str(output),'tour_count':None,'trip_count':None,
                'mode_shares_MODELED':None,'final_files':{},'outcomes_accessed':False}
        stage='prefix'
        try:
            cfg=config(name+'-prefix',arm,models=PREFIX,chunk_size=268435456)
            run(name+'-prefix',cfg,m.INPUT/'bundle',output,allocator=True)
            log=(E/(name+'-prefix.engine.log')).read_text()
            m.save(name+'-chunks.json',verify_chunking(log))
            stage='suffix'
            cfg=config(name+'-suffix',arm,mode='disabled',resume=m.BOUNDARY)
            run(name+'-suffix',cfg,m.INPUT/'bundle',output,allocator=True)
            record['completion']='complete'
            record['final_files']={p.name:m.digest(p) for p in output.glob('final_*.csv')}
            stage='modeled-health'
            command=['systemd-run','--user','--scope','--unit=tbi-memory-health-'+arm,'-p','MemoryMax=9G','-p','MemorySwapMax=0',
                sys.executable,'-B',str(E.parent/'chunk-cause-evidence/modeled-health.py'),str(output),str(E/(name+'-modeled-health.json')),
                str(m.INPUT/'bundle/configs/network_los.yaml')]
            with (E/(name+'-health.log')).open('x') as out:
                subprocess.run(command,stdout=out,stderr=subprocess.STDOUT,check=True)
            health=json.loads((E/(name+'-modeled-health.json')).read_text())
            record.update(tour_count=health['tour_count'],trip_count=health['trip_count'],mode_shares_MODELED=health['domains_MODELED']['overall'])
        except (RuntimeError, subprocess.CalledProcessError) as exc:
            record.update(stopped_stage=stage,error=str(exc))
            if record['completion']!='complete': record['completion']='failed'
        records.append(record); m.save('allocator-full-runs.json',records)
        print(json.dumps(record),flush=True)


if __name__=='__main__': main()
