"""Use the fresh cache with a smaller target that exercises actual chooser splitting."""
import json
import shutil
from prepare import m, E, config, PREFIX, OLD_R
from execute import run
from admission import verify_inputs, verify_files, verify_chunking


def main():
    verify_inputs()
    cache=m.R/'training-2000/cache/chunk_cache.csv'
    m.save('allocator-before-run.json',{'households':2000,'persons':4971,'prefix_chunk_size':268435456,
        'allocator_environment':{'MALLOC_MMAP_THRESHOLD_':'131072','MALLOC_TRIM_THRESHOLD_':'0','MALLOC_ARENA_MAX':'2'},'min_available_chunk_ratio':0.05,'prefix_mode':'production','suffix_chunk_size':0,
        'suffix_mode':'disabled','cache_sha256':m.digest(cache),'outcomes_accessed':False})
    for arm, ref in [('current','r2-2000-current-reference'),('semcog','r3-2000-semcog-reference')]:
        reference=OLD_R/ref
        verify_files(reference,json.loads((E.parent/'chunk-cause-evidence'/(ref+'.run.json')).read_text())['final_files'])
        name='alloc-2000-'+arm;output=m.R/name;output.mkdir();(output/'cache').mkdir()
        shutil.copyfile(cache,output/'cache/chunk_cache.csv')
        cfg=config(name+'-prefix',arm,models=PREFIX,chunk_size=268435456)
        run(name+'-prefix',cfg,m.INPUT/'inputs-2000',output,allocator=True)
        log=(E/(name+'-prefix.engine.log')).read_text()
        m.save(name+'-chunks.json',verify_chunking(log))
        cfg=config(name+'-suffix',arm,mode='disabled',resume=m.BOUNDARY)
        run(name+'-suffix',cfg,m.INPUT/'inputs-2000',output,allocator=True)
        if not m.compare(name,reference,output):raise RuntimeError('Choice parity failed; stop')
    m.save('allocator-parity-result.json',{'status':'passed_choice_parity','cache_sha256':m.digest(cache),'outcomes_accessed':False})


if __name__=='__main__':main()
