"""Prepare outcome-free memory diagnosis and explicitly declared smaller chunks."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import pandas as pd

E = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('hybrid', E.parent/'chunk-cause-evidence/run-hybrid.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.E = E
m.R = m.REPO/'data/_screening_cache/tbi2019-memory-fit'
OLD_R = Path('/home/nathaniel/.t3/worktrees/openplan/t3-85dfd8b2/data/_screening_cache/tbi2019-chunk-cause')
CACHE = OLD_R/'training-2000-prefix/cache/chunk_cache.csv'
MODELS = m.yaml.safe_load((m.INPUT/'bundle/configs/settings.yaml').read_text())['models']
PREFIX = MODELS[:MODELS.index('trip_scheduling')]


def config(name, arm='current', mode='production', models=None, resume=None, chunk_size=1073741824):
    cfg = m.config(name, arm, mode, models=models, resume=resume)
    settings = m.yaml.safe_load((cfg/'settings.yaml').read_text())
    settings['chunk_size'] = 0 if mode == 'disabled' else chunk_size
    settings['min_available_chunk_ratio'] = 0.05
    (cfg/'settings.yaml').write_text(m.yaml.safe_dump(settings, sort_keys=False))
    return cfg


if __name__ == '__main__':
    data = m.R/'inputs-20000'; data.mkdir()
    hh = pd.read_csv(m.INPUT/'bundle/households.csv')
    ids = sorted(hh.household_id, key=lambda x: hashlib.sha256(f'tbi2019-memory-20000-v1:{x}'.encode()).digest())[:20000]
    hh[hh.household_id.isin(ids)].to_csv(data/'households.csv', index=False)
    people = 0
    for i, frame in enumerate(pd.read_csv(m.INPUT/'bundle/persons.csv', chunksize=100000)):
        part = frame[frame.household_id.isin(ids)]
        part.to_csv(data/'persons.csv', mode='w' if i == 0 else 'a', header=i == 0, index=False)
        people += len(part)
    for name in ['land_use.csv', 'skims']:
        (data/name).symlink_to(m.INPUT/'bundle'/name)
    output = m.R/'profile-20000'; output.mkdir(); (output/'cache').mkdir()
    shutil.copyfile(CACHE, output/'cache/chunk_cache.csv')
    cfg = config('profile-20000', models=MODELS[:4], chunk_size=5500000000)
    m.save('profile-before-run.json', {'households': 20000, 'persons': people, 'selection': 'lowest SHA256(tbi2019-memory-20000-v1:household_id)',
        'cache_sha256': m.digest(CACHE), 'chunk_size': 5500000000, 'purpose': 'Memory diagnosis only, not a full arm',
        'input_hashes': {p.name: m.digest(p) for p in data.glob('*.csv')}, 'outcomes_accessed': False})
    print(cfg)
