"""Measure the admitted smaller production target on the same diagnostic population."""
import shutil
from prepare import m, E, config, MODELS
from execute import run

name='profile-20000-reduced';output=m.R/name;output.mkdir();(output/'cache').mkdir()
cache=m.R/'training-2000/cache/chunk_cache.csv'
shutil.copyfile(cache,output/'cache/chunk_cache.csv')
cfg=config(name,models=MODELS[:4],chunk_size=268435456)
run(name,cfg,m.R/'inputs-20000',output,profile=True)
