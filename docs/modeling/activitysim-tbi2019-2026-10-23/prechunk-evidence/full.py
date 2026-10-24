"""Run admitted full arms serially; stop at the first resource or engine failure."""
import argparse
import json
from prepare import E, m, CACHE, OLD_R, PREFIX, config, output
from prove import verify_inputs
from execute import run
from activitysim_chunk_parity import compare_tables


def admit(variant):
    verify_inputs()
    proof = json.loads((E/(variant+'-parity.json')).read_text())
    if proof.get('status') != 'passed_exact_parity' or proof.get('cache_sha256') != m.digest(CACHE):
        raise RuntimeError('Exact parity/cache admission failed')
    for arm, ref in [('current','r2-2000-current-reference'), ('semcog','r3-2000-semcog-reference')]:
        receipt = json.loads((E/(variant+'-2000-'+arm+'.comparison.json')).read_text())
        tables = compare_tables(OLD_R/ref, m.R/(variant+'-2000-'+arm))
        if receipt.get('status') != 'passed_exact_parity' or tables != receipt['tables']:
            raise RuntimeError('Exact reference/candidate custody changed')
        m.save('full-preflight-'+arm+'.json', tables)


def main(variant):
    admit(variant)
    m.save('full-before-run.json', {'variant':variant, 'households':1060601, 'persons':2617177,
        'zones':634, 'prefix_chunk_size':268435456, 'suffix_chunk_size':0,
        'cache_sha256':m.digest(CACHE), 'outcomes_accessed':False, 'stop_on_failure':True})
    records = [{'arm':arm, 'status':'not_run', 'tours':None, 'trips':None, 'mode_shares_MODELED':None,
                'final_hashes':{}, 'outcomes_accessed':False} for arm in ['current','semcog']]
    m.save('full-runs.json', records)
    for record in records:
        arm = record['arm']
        name = 'full-'+arm
        out = output(name)
        record['output'] = str(out)
        record['status'] = 'running_prefix'
        m.save('full-runs.json', records)
        try:
            cfg = config(name+'-prefix', arm, models=PREFIX, downcast=variant == 'integer')
            run(name+'-prefix', cfg, m.R/'inputs-full', out, profile=True, allocator=True)
            record['status'] = 'running_suffix'
            m.save('full-runs.json', records)
            cfg = config(name+'-suffix', arm, mode='disabled', resume=m.BOUNDARY, downcast=variant == 'integer')
            run(name+'-suffix', cfg, m.R/'inputs-full', out, allocator=True)
        except RuntimeError as exc:
            record.update(status='failed', error=str(exc))
            m.save('full-runs.json', records)
            raise
        record.update(status='complete_pending_modeled_health', final_hashes={p.name:m.digest(p) for p in out.glob('final_*.csv')})
        m.save('full-runs.json', records)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('variant', choices=['columns','integer'])
    main(parser.parse_args().variant)
