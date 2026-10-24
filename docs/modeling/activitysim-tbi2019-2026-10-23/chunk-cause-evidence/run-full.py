"""Run the two full retained-population arms only after all four hybrid proofs."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys

spec = importlib.util.spec_from_file_location('hybrid', Path(__file__).with_name('run-hybrid.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def admit_full():
    result = json.loads((m.E / 'hybrid-result.json').read_text())
    if result.get('status') != 'passed_choice_parity' or result.get('full_runs_authorized') is not True:
        raise RuntimeError('Four-subset-arm proof has not passed')
    freeze = json.loads((m.E / 'hybrid-before-run.json').read_text())
    cache = Path(freeze['cache_origin'])
    if m.digest(cache) != freeze['cache_sha256']:
        raise RuntimeError('Proven cache bytes changed')
    for size in [64, 2000]:
        for arm in ['current', 'semcog']:
            label = f'r3-{size}-{arm}'
            reused = m.E / (label + '-reference.reused.json')
            reference = Path(json.loads(reused.read_text())['output']) if reused.exists() else m.R / (label + '-reference')
            if not m.compare('full-preflight-' + label, reference, m.R / (label + '-hybrid')):
                raise RuntimeError('Retained proof no longer passes')
    return cache


def main():
    cache = admit_full()
    freeze = json.loads((m.E.parent / 'choice-parity-evidence/input-freeze.json').read_text())
    # Reuse the controller's exact-input refusal before full-population execution.
    for name, expected in freeze['inputs']['bundle'].items():
        if m.digest(m.INPUT / 'bundle' / name) != expected:
            raise RuntimeError('Frozen input hash mismatch')
    models = m.yaml.safe_load((m.INPUT / 'bundle/configs/settings.yaml').read_text())['models']
    prefix = models[:models.index('trip_scheduling')]
    m.save('full-before-run.json', {'households': 1060601, 'persons': 2617177, 'zones': 634,
           'arms': ['current', 'semcog'], 'prefix_chunk_size': 5500000000,
           'min_available_chunk_ratio': 0.05, 'prefix_mode': 'production',
           'suffix_mode': 'disabled', 'suffix_chunk_size': 0, 'boundary': m.BOUNDARY,
           'cache_sha256': m.digest(cache), 'outcomes_accessed': False,
           'comparison_boundary': 'Each arm independently reports modeled run health. No observations or cross-arm accuracy comparison.'})
    records = []
    for arm in ['current', 'semcog']:
        name = 'full-' + arm
        output = m.R / name; output.mkdir()
        (output / 'cache').mkdir(); shutil.copyfile(cache, output / 'cache/chunk_cache.csv')
        record = {'arm': arm, 'output': str(output), 'completion': 'not_complete', 'stages': [],
                  'tour_count': None, 'trip_count': None, 'mode_shares_MODELED': None, 'outcomes_accessed': False}
        stage = 'prefix'
        try:
            cfg = m.config(name + '-prefix', arm, 'production', models=prefix)
            settings = m.yaml.safe_load((cfg / 'settings.yaml').read_text())
            settings['chunk_size'] = 5500000000
            (cfg / 'settings.yaml').write_text(m.yaml.safe_dump(settings, sort_keys=False))
            record['stages'].append(m.run(name + '-prefix', cfg, m.INPUT / 'bundle', output))
            log = (m.E / (name + '-prefix.stdout.log')).read_text()
            record['chunking'] = m.chunk_evidence(log)
            if 'initial_row_size is zero' in log:
                raise RuntimeError('Production cache coverage missing; suffix refused')
            m.save(name + '-checkpoint.json', {str(p.relative_to(output)): m.digest(p)
                   for p in (output / 'pipeline.parquetpipeline').rglob('*') if p.is_file()})
            stage = 'suffix'
            cfg = m.config(name + '-suffix', arm, 'disabled', resume=m.BOUNDARY)
            record['stages'].append(m.run(name + '-suffix', cfg, m.INPUT / 'bundle', output))
            stage = 'health_summary'
            # A separate capped scope streams final CSVs into a local SQLite reporting file.
            command = ['systemd-run', '--user', '--scope', '--unit=tbi-health-' + arm,
                       '-p', 'MemoryMax=9G', '-p', 'MemorySwapMax=0', sys.executable, '-B',
                       str(m.E / 'modeled-health.py'), str(output), str(m.E / (name + '-modeled-health.json')),
                       str(m.INPUT / 'bundle/configs/network_los.yaml')]
            with (m.E / (name + '-health-summary.stdout.log')).open('x') as stream:
                completed = m.subprocess.run(command, stdout=stream, stderr=m.subprocess.STDOUT)
            record['health_summary_exit_code'] = completed.returncode
            record['completion'] = 'complete'
            if completed.returncode == 0:
                summary = json.loads((m.E / (name + '-modeled-health.json')).read_text())
                record.update(tour_count=summary['tour_count'], trip_count=summary['trip_count'],
                              mode_shares_MODELED=summary['domains_MODELED']['overall'])
            else:
                record['health_summary_status'] = 'failed; completed model outputs remain retained'
        except (RuntimeError, AssertionError) as exc:
            record.update(completion='failed', stopped_stage=stage, error=str(exc))
            failed_receipt = m.E / (name + '-' + stage + '.run.json')
            if failed_receipt.exists():
                failed = json.loads(failed_receipt.read_text())
                if failed not in record['stages']: record['stages'].append(failed)
        records.append(record)
        m.save('full-runs.json', records)
        print(json.dumps({'arm': arm, 'completion': record['completion'], 'stopped_stage': record.get('stopped_stage')}), flush=True)


if __name__ == '__main__': main()
