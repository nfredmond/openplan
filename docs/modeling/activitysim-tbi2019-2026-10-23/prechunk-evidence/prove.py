"""Require exact seven-table equality for each isolated reduction and coefficient arm."""
import argparse
import json
from prepare import E, m, OLD_R, CACHE, PREFIX, config, output
from execute import run
from activitysim_chunk_parity import compare_tables, chunk_evidence


def verify_inputs():
    freeze = json.loads((E.parent/'choice-parity-evidence/input-freeze.json').read_text())
    for folder in ['bundle', 'inputs-2000']:
        for name, expected in freeze['inputs'][folder].items():
            if m.digest(m.INPUT/folder/name) != expected:
                raise RuntimeError('Frozen input custody mismatch')
    scan = json.loads((E/'input-column-scan.json').read_text())
    for name, row in scan['inputs'].items():
        if m.digest(m.R/name) != row['candidate_sha256']:
            raise RuntimeError('Reduced input custody mismatch')


def prove(variant):
    verify_inputs()
    m.save(variant+'-before-run.json', {'downcast_int': variant == 'integer', 'downcast_float': False,
        'cache_sha256':m.digest(CACHE), 'households':2000, 'persons':4971, 'exact_all_values':True,
        'outcomes_accessed':False})
    for arm, ref in [('current','r2-2000-current-reference'), ('semcog','r3-2000-semcog-reference')]:
        reference = OLD_R/ref
        expected = json.loads((E.parent/'chunk-cause-evidence'/(ref+'.run.json')).read_text())['final_files']
        if {p.name:m.digest(p) for p in reference.glob('final_*.csv')} != expected:
            raise RuntimeError('Reference custody mismatch')
        name = variant+'-2000-'+arm
        out = output(name)
        cfg = config(name+'-prefix', arm, models=PREFIX, downcast=variant == 'integer')
        run(name+'-prefix', cfg, m.R/'inputs-2000', out, allocator=True)
        log = (E/(name+'-prefix.engine.log')).read_text()
        if 'initial_row_size is zero' in log:
            raise RuntimeError('Production cache coverage missing')
        m.save(name+'-chunks.json', chunk_evidence(log))
        cfg = config(name+'-suffix', arm, mode='disabled', resume=m.BOUNDARY, downcast=variant == 'integer')
        run(name+'-suffix', cfg, m.R/'inputs-2000', out, allocator=True)
        try:
            tables = compare_tables(reference, out)
        except AssertionError as exc:
            m.save(name+'.comparison.json', {'status':'failed_exact_parity', 'error':str(exc)})
            raise
        m.save(name+'.comparison.json', {'status':'passed_exact_parity', 'tables':tables})
    m.save(variant+'-parity.json', {'status':'passed_exact_parity', 'cache_sha256':m.digest(CACHE)})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('variant', choices=['columns', 'integer'])
    prove(parser.parse_args().variant)
