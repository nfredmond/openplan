"""Bind execution admission to frozen inputs, sizing cache, and both proven arms."""
import json
from prepare import E, m, OLD_R


def verify_inputs():
    freeze = json.loads((E.parent/'choice-parity-evidence/input-freeze.json').read_text())
    for folder in ['bundle', 'inputs-2000']:
        for name, expected in freeze['inputs'][folder].items():
            if m.digest(m.INPUT/folder/name) != expected:
                raise RuntimeError('Input custody mismatch')


def verify_files(root, expected):
    if {p.name:m.digest(p) for p in root.glob('final_*.csv')} != expected:
        raise RuntimeError('Reference final-file custody mismatch')


def admit_full():
    verify_inputs()
    result = json.loads((E/'parity-result.json').read_text())
    cache = m.R/'training-2000/cache/chunk_cache.csv'
    if result.get('status') != 'passed_choice_parity' or m.digest(cache) != result['cache_sha256']:
        raise RuntimeError('Production parity/cache admission failed')
    for arm, ref in [('current','r2-2000-current-reference'),('semcog','r3-2000-semcog-reference')]:
        receipt = json.loads((E.parent/'chunk-cause-evidence'/(ref+'.run.json')).read_text())
        verify_files(OLD_R/ref, receipt['final_files'])
        name='fit-2000-'+arm
        comparison = json.loads((E/(name+'.comparison.json')).read_text())
        expected = {table['table']:table['candidate_sha256'] for table in comparison['tables']}
        verify_files(m.R/name, expected)
        if not m.compare('full-preflight-'+arm, OLD_R/ref, m.R/name):
            raise RuntimeError('Choice parity no longer passes')
    return cache


def verify_chunking(log):
    if 'initial_row_size is zero' in log:
        raise RuntimeError('Incomplete production cache')
    return m.chunk_evidence(log)
