"""Retrain on 2,000 whole households and compare both hybrid arms to pinned references."""
import json
from pathlib import Path
import shutil
from prepare import m, E, config, PREFIX, OLD_R
from execute import run


from admission import verify_files, verify_inputs


def main():
    verify_inputs()
    m.save('parity-before-run.json', {'households':2000,'persons':4971,'prefix_chunk_size':1073741824,
        'prefix_mode':'production','min_available_chunk_ratio':0.05,'suffix_chunk_size':0,
        'training_chunk_size':536870912,'training_min_available_chunk_ratio':1.0,
        'criterion':json.loads((E.parent/'chunk-cause-evidence/criterion.json').read_text()),
        'outcomes_accessed':False})
    output=m.R/'training-2000'; output.mkdir()
    cfg=config('training-2000',mode='training',models=PREFIX,chunk_size=536870912)
    settings=m.yaml.safe_load((cfg/'settings.yaml').read_text()); settings['min_available_chunk_ratio']=1.0
    (cfg/'settings.yaml').write_text(m.yaml.safe_dump(settings,sort_keys=False))
    run('training-2000',cfg,m.INPUT/'inputs-2000',output)
    cache=output/'cache/chunk_cache.csv'
    m.save('trained-cache.json',{'path':str(cache),'sha256':m.digest(cache)})
    for arm, reference_name in [('current','r2-2000-current-reference'),('semcog','r3-2000-semcog-reference')]:
        reference=OLD_R/reference_name
        receipt=json.loads((E.parent/'chunk-cause-evidence'/(reference_name+'.run.json')).read_text())
        verify_files(reference,receipt['final_files'])
        name='parity-2000-'+arm; output=m.R/name; output.mkdir(); (output/'cache').mkdir()
        shutil.copyfile(cache,output/'cache/chunk_cache.csv')
        cfg=config(name+'-prefix',arm,models=PREFIX)
        run(name+'-prefix',cfg,m.INPUT/'inputs-2000',output)
        log=(E/(name+'-prefix.engine.log')).read_text()
        if 'initial_row_size is zero' in log:
            raise RuntimeError('Incomplete production cache')
        m.save(name+'-chunks.json',m.chunk_evidence(log))
        cfg=config(name+'-suffix',arm,mode='disabled',resume=m.BOUNDARY)
        run(name+'-suffix',cfg,m.INPUT/'inputs-2000',output)
        if not m.compare(name,reference,output):
            raise RuntimeError('Choice parity failed; stop')
    m.save('parity-result.json',{'status':'passed_choice_parity','cache_sha256':m.digest(cache),'outcomes_accessed':False})


if __name__=='__main__': main()
