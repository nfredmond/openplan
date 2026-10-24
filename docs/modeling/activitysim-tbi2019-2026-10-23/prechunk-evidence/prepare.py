"""Bind this successor to retained public inputs, references, and trained chunk sizes."""
import importlib.util
from pathlib import Path
import shutil

E = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('hybrid', E.parent/'chunk-cause-evidence/run-hybrid.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.E = E
m.R = m.REPO/'data/_screening_cache/tbi2019-prechunk'
OLD_R = Path('/home/nathaniel/.t3/worktrees/openplan/t3-85dfd8b2/data/_screening_cache/tbi2019-chunk-cause')
MEMORY_R = Path('/home/nathaniel/.t3/worktrees/openplan/t3-7ed7ca64/data/_screening_cache/tbi2019-memory-fit')
CACHE = MEMORY_R/'training-2000/cache/chunk_cache.csv'
MODELS = m.yaml.safe_load((m.INPUT/'bundle/configs/settings.yaml').read_text())['models']
PREFIX = MODELS[:MODELS.index('trip_scheduling')]


def config(name, arm='current', mode='production', models=None, resume=None, downcast=False):
    cfg = m.config(name, arm, mode, models=models, resume=resume)
    settings = m.yaml.safe_load((cfg/'settings.yaml').read_text())
    settings.update(chunk_size=0 if mode == 'disabled' else 268435456,
                    min_available_chunk_ratio=0.05, downcast_int=downcast, downcast_float=False)
    (cfg/'settings.yaml').write_text(m.yaml.safe_dump(settings, sort_keys=False))
    return cfg


def output(name):
    folder = m.R/name
    folder.mkdir()
    (folder/'cache').mkdir()
    shutil.copyfile(CACHE, folder/'cache/chunk_cache.csv')
    return folder
