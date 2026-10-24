"""Outcome-free, sequential proof of a checkpointed chunking boundary."""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import activitysim
import yaml

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'scripts/modeling'))
from activitysim_choice_parity import ParityFailure, compare_choices, chunk_evidence, digest

E = Path(__file__).resolve().parent
R = REPO / 'data/_screening_cache/tbi2019-chunk-cause'
INPUT = Path('/home/nathaniel/.t3/worktrees/openplan/t3-fe427aa8/data/_screening_cache/tbi2019-choice-parity')
OLD = Path('/home/nathaniel/.t3/worktrees/openplan/t3-8dddce31/data/_screening_cache/tbi2019-convergence')
STOCK = Path(activitysim.__file__).parent / 'examples/prototype_mtc/configs'
BOUNDARY = 'trip_purpose_and_destination'


def save(name, value):
    (E / name).write_text(json.dumps(value, indent=2) + '\n')


def config(name, arm, mode, models=None, resume=None, logic=None):
    folder = R / ('config-' + name)
    shutil.copytree(INPUT / f'parity-config-{arm}-{mode}', folder)
    settings = yaml.safe_load((folder / 'settings.yaml').read_text())
    # Preserve the stock minimum chooser allocation when process baseline RSS exceeds the target.
    # The independent cgroup remains the 9 GiB hard limit. Full runs retain their 5.5 GB target.
    if mode == 'production':
        settings['min_available_chunk_ratio'] = 0.05
    settings['checkpoints'] = True
    if models is not None:
        settings['models'] = models
    if resume is not None:
        settings['resume_after'] = resume
    if logic is not None:
        trip_settings = yaml.safe_load((STOCK / 'trip_scheduling.yaml').read_text())
        trip_settings['logic_version'] = logic
        (folder / 'trip_scheduling.yaml').write_text(yaml.safe_dump(trip_settings, sort_keys=False))
    (folder / 'settings.yaml').write_text(yaml.safe_dump(settings, sort_keys=False))
    return folder


def run(name, config_dir, data, output):
    command = ['systemd-run', '--user', '--scope', '--unit=tbi-hybrid-' + name,
               '-p', 'MemoryMax=9G', '-p', 'MemorySwapMax=0',
               'env', 'OPENBLAS_NUM_THREADS=1', 'OMP_NUM_THREADS=1',
               sys.executable, '-B', str(E.parent / 'convergence-evidence/scope-runner.py'),
               str(E / (name + '.health.json')), sys.executable, '-B', '-m', 'activitysim', 'run',
               '-c', str(config_dir), '-c', str(INPUT / 'bundle/configs'), '-c', str(STOCK),
               '-d', str(data), '-o', str(output)]
    record = {'name': name, 'command': command, 'config_files':
              {p.name: digest(p) for p in config_dir.iterdir() if p.is_file()}}
    save(name + '.started.json', record)
    start = time.monotonic()
    with (E / (name + '.stdout.log')).open('x') as stream:
        completed = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT)
    record.update(exit_code=completed.returncode, elapsed_seconds=time.monotonic() - start)
    health = E / (name + '.health.json')
    if health.exists():
        record['health'] = json.loads(health.read_text())
    record['final_files'] = {p.name: digest(p) for p in output.glob('final_*.csv')}
    save(name + '.run.json', record)
    print(json.dumps({'run': name, 'exit_code': completed.returncode}), flush=True)
    if completed.returncode:
        raise RuntimeError(f'Engine failure in {name}; no further execution')
    return record


def compare(name, reference, candidate):
    try:
        tables = compare_choices(reference, candidate)
    except ParityFailure as exc:
        save(name + '.comparison.json', {'status': 'failed_choice_parity', 'differences': exc.records,
                                       'tables': exc.tables, 'full_runs_authorized': False})
        return False
    save(name + '.comparison.json', {'status': 'passed_choice_parity', 'tables': tables})
    return True


def logic_probe():
    name = 'logic2-64-complete'
    output = R / name
    output.mkdir()
    subprocess.run(['cp', '-a', '--reflink=auto',
                    str(OLD / 'parity-current-disabled/pipeline.parquetpipeline'),
                    str(output / 'pipeline.parquetpipeline')], check=True)
    cfg = config(name, 'current', 'disabled', resume=BOUNDARY, logic=2)
    run(name, cfg, INPUT / 'parity-inputs', output)
    compare(name, OLD / 'parity-current-disabled', output)


def proof():
    models = yaml.safe_load((INPUT / 'bundle/configs/settings.yaml').read_text())['models']
    prefix = models[:models.index('trip_scheduling')]
    cache = OLD / 'parity-current-training/cache/chunk_cache.csv'
    freeze = json.loads((E.parent / 'choice-parity-evidence/input-freeze.json').read_text())
    for folder, files in freeze['inputs'].items():
        for name, expected in files.items():
            if digest(INPUT / folder / name) != expected:
                raise RuntimeError('Frozen input hash mismatch')
    save('hybrid-before-run.json', {'criterion': json.loads((E / 'criterion.json').read_text()),
         'boundary': BOUNDARY, 'sizes': [64, 2000], 'arms': ['current', 'semcog'],
         'prefix_mode': 'production', 'prefix_chunk_size': 67108864, 'min_available_chunk_ratio': 0.05,
         'suffix_mode': 'disabled', 'suffix_chunk_size': 0, 'cache_sha256': digest(cache),
         'cache_origin': str(cache), 'cache_reuse': 'Both coefficients use the unchanged sizing cache; all model settings and coefficient values remain arm-specific.',
         'full_settings': 'Prefix production chunk_size 5500000000, inherited min_available_chunk_ratio 0.05; suffix disabled. Not admitted until all four comparisons pass.',
         'outcomes_accessed': False})
    for size in [64, 2000]:
        data = INPUT / ('parity-inputs' if size == 64 else 'inputs-2000')
        for arm in ['current', 'semcog']:
            label = f'r2-{size}-{arm}'
            reference = R / (label + '-reference'); reference.mkdir()
            cfg = config(label + '-reference', arm, 'disabled')
            run(label + '-reference', cfg, data, reference)
            output = R / (label + '-hybrid'); output.mkdir()
            (output / 'cache').mkdir(); shutil.copyfile(cache, output / 'cache/chunk_cache.csv')
            cfg = config(label + '-prefix', arm, 'production', models=prefix)
            run(label + '-prefix', cfg, data, output)
            log = (E / (label + '-prefix.stdout.log')).read_text()
            evidence = chunk_evidence(log)
            if 'initial_row_size is zero' in log:
                raise RuntimeError('Production cache coverage missing; no fallback admitted')
            save(label + '-chunking.json', evidence)
            # Preserve the prefix checkpoint and cache evidence before resuming in place.
            save(label + '-checkpoint.json', {str(p.relative_to(output)): digest(p)
                 for p in (output / 'pipeline.parquetpipeline').rglob('*') if p.is_file()})
            cfg = config(label + '-suffix', arm, 'disabled', resume=BOUNDARY)
            run(label + '-suffix', cfg, data, output)
            if not compare(label + '-hybrid', reference, output):
                save('hybrid-result.json', {'status': 'failed_choice_parity', 'stopped_at': label,
                     'full_runs_authorized': False, 'outcomes_accessed': False})
                return 2
    save('hybrid-result.json', {'status': 'passed_choice_parity', 'full_runs_authorized': True,
                             'outcomes_accessed': False})
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['logic-probe', 'proof'])
    args = parser.parse_args()
    if args.action == 'logic-probe':
        logic_probe()
    else:
        sys.exit(proof())
