"""Train native sizing on the larger frozen input without running trip scheduling."""
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('hybrid',Path(__file__).with_name('run-hybrid.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
models=m.yaml.safe_load((m.INPUT/'bundle/configs/settings.yaml').read_text())['models']
prefix=models[:models.index('trip_scheduling')]
name='training-2000-prefix'
output=m.R/name;output.mkdir()
cfg=m.config(name,'current','training',models=prefix)
settings=m.yaml.safe_load((cfg/'settings.yaml').read_text())
settings['chunk_size']=536870912
settings['min_available_chunk_ratio']=1.0
(cfg/'settings.yaml').write_text(m.yaml.safe_dump(settings,sort_keys=False))
m.save('cache-training-before-run.json',{'input_freeze':'../choice-parity-evidence/input-freeze.json','households':2000,'persons':4971,'last_model':prefix[-1],'chunk_size':536870912,'min_available_chunk_ratio':1.0,'mode':'training','scope_max_bytes':9663676416,'scope_swap_max_bytes':0,'outcomes_accessed':False,'claim':'Cache preparation only. No trip scheduling, final comparison or full-run admission.'})
m.run(name,cfg,m.INPUT/'inputs-2000',output)
cache=output/'cache/chunk_cache.csv'
m.save('trained-cache.json',{'cache':str(cache),'sha256':m.digest(cache),'bytes':cache.stat().st_size,'outcomes_accessed':False})
