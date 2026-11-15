#!/usr/bin/env python3
"""Explicit development transfer of donor walk constants, never a default overlay."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / 'data/modeling/activitysim-semcog-walk-development-v1'
NAME = 'semcog2015-walk-asc-development-v1'
PURPOSES = ('eatout', 'escort', 'othdiscr', 'othmaint', 'school', 'shopping', 'social', 'univ', 'work')
AUTO_CLASSES = ('no_auto', 'auto_deficient', 'auto_sufficient')
KEYS = tuple(f'walk_ASC_{a}_{p}' for a in AUTO_CLASSES for p in PURPOSES)
SCHEMA = 'openplan.activitysim-walk-transfer-development.v1'
STOP = 'non_mandatory_tour_scheduling'
MODE = 'tour_mode_choice_simulate'


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def read_coefficients(path: Path) -> dict[str, str]:
    rows = {}
    for row in csv.DictReader(io.StringIO(path.read_text())):
        name = row['coefficient_name']
        if name in rows:
            raise ValueError('duplicate coefficient')
        if name.startswith('#') or not name:
            continue
        value = row['value']
        if not math.isfinite(float(value)):
            raise ValueError('nonfinite coefficient')
        rows[name] = value
    return rows


def compatible_mapping(stock: Path, source: Path) -> None:
    # Matching indicator expressions and purpose templates is necessary but does
    # not establish transfer between different regional alternative sets.
    for filename in ('tour_mode_choice.csv',):
        parsed = [list(csv.DictReader(io.StringIO((folder / filename).read_text()))) for folder in (stock, source)]
        for a in AUTO_CLASSES:
            key = 'walk_ASC_' + a
            matches = [[r for r in rows if r.get('WALK') == key] for rows in parsed]
            if any(len(m) != 1 for m in matches) or matches[0][0]['Expression'] != matches[1][0]['Expression']:
                raise ValueError('incompatible WALK expression')
    templates = []
    for folder, filename in ((stock, 'tour_mode_choice_coefficients_template.csv'),
                             (source, 'tour_mode_choice_coeffs_template.csv')):
        templates.append({r['coefficient_name']: r for r in csv.DictReader(io.StringIO((folder / filename).read_text()))})
    for a in AUTO_CLASSES:
        for p in PURPOSES:
            key = 'walk_ASC_' + a
            if templates[0][key][p] != templates[1][key][p] or templates[0][key][p] != key + '_' + p:
                raise ValueError('incompatible purpose template')


def build_overlay(stock: Path, destination: Path, name: str | None = None) -> dict:
    if name is None:
        return {'status': 'default_unchanged', 'files': {}}
    if name != NAME:
        raise ValueError('unknown development coefficient set')
    source = PACKAGE / 'source'
    manifest = json.loads((source / 'source-manifest.json').read_text())
    for filename, entry in manifest['files'].items():
        if digest(source / filename) != entry['sha256']:
            raise ValueError('donor source hash mismatch')
    inventory = json.loads((ROOT / 'docs/modeling/activitysim-coefficients-2026-10-23/stock-files.json').read_text())
    for filename in ('tour_mode_choice_coefficients.csv', 'tour_mode_choice.csv',
                     'tour_mode_choice_coefficients_template.csv', 'tour_mode_choice.yaml'):
        if digest(stock / filename) != inventory['files'][filename]['sha256']:
            raise ValueError('stock source hash mismatch')
    compatible_mapping(stock, source)
    donor = read_coefficients(source / 'tour_mode_choice_coeffs.csv')
    baseline = read_coefficients(stock / 'tour_mode_choice_coefficients.csv')
    if not set(KEYS) <= donor.keys() or not set(KEYS) <= baseline.keys():
        raise ValueError('missing walk coefficient')
    original = (stock / 'tour_mode_choice_coefficients.csv').read_bytes()
    changed = []
    lines = []
    for line in original.splitlines(keepends=True):
        row = next(csv.reader([line.decode()]))
        if row and row[0] in KEYS:
            old = row[1]
            # These pinned files use unquoted scalar rows. Preserve every other byte.
            line = line.replace((',' + old + ',').encode(), (',' + donor[row[0]] + ',').encode(), 1)
            changed.append({'coefficient': row[0], 'baseline': old, 'candidate': donor[row[0]]})
        lines.append(line)
    if {x['coefficient'] for x in changed} != set(KEYS) or len(changed) != len(KEYS):
        raise ValueError('transfer census mismatch')
    destination.mkdir(parents=True, exist_ok=False)
    target = destination / 'tour_mode_choice_coefficients.csv'
    target.write_bytes(b''.join(lines))
    result = {'schema_version': 'openplan.activitysim-development-coefficient-set.v1',
              'name': name, 'status': 'development_only_not_accepted',
              'component': 'primary_tour_mode_choice', 'source_manifest_sha256': digest(source / 'source-manifest.json'),
              'baseline_sha256': hashlib.sha256(original).hexdigest(),
              'files': {target.name: digest(target)}, 'transfers': changed}
    (destination / 'coefficient-set.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def check_probabilities(values, expected_index=None):
    import numpy as np
    if values.index.has_duplicates or (expected_index is not None and set(values.index) != set(expected_index)):
        raise ValueError('chooser coverage mismatch')
    a = values.to_numpy()
    if not np.isfinite(a).all() or (a < 0).any() or (a > 1).any() or not np.allclose(a.sum(axis=1), 1.0, atol=1e-8, rtol=0):
        raise ValueError('invalid native probabilities')
    if 'WALK' not in values:
        raise ValueError('WALK probability absent')


def compare(baseline, candidate, replay, strata):
    import numpy as np
    check_probabilities(baseline, strata.index)
    check_probabilities(candidate, strata.index)
    check_probabilities(replay, strata.index)
    baseline = baseline.sort_index()
    candidate = candidate.reindex(index=baseline.index, columns=baseline.columns)
    replay = replay.reindex(index=baseline.index, columns=baseline.columns)
    check_probabilities(candidate, baseline.index)
    if not np.array_equal(baseline.to_numpy(), replay.to_numpy()):
        raise ValueError('baseline replay differs')
    if np.array_equal(baseline.to_numpy(), candidate.to_numpy()):
        raise ValueError('candidate has no probability effect')
    strata = strata.reindex(baseline.index)
    joint = strata['category'] == 'joint'
    if not np.array_equal(baseline.loc[joint].to_numpy(), candidate.loc[joint].to_numpy()):
        raise ValueError('joint probabilities changed')
    rows = []
    groups = [('all', np.ones(len(strata), dtype=bool))]
    for p in PURPOSES:
        groups.append((f'purpose:{p}', (strata.purpose == p).to_numpy()))
    for a in AUTO_CLASSES:
        groups.append((f'auto:{a}', (strata.auto_class == a).to_numpy()))
    for p in PURPOSES:
        for a in AUTO_CLASSES:
            for c in ('individual', 'joint'):
                groups.append((f'{p}/{a}/{c}', ((strata.purpose == p) & (strata.auto_class == a) & (strata.category == c)).to_numpy()))
    for label, mask in groups:
        n = int(mask.sum())
        modes = {}
        for mode in baseline.columns:
            m = {}
            for side, frame in [('baseline', baseline), ('candidate', candidate)]:
                x = frame.loc[mask, mode].to_numpy()
                mean = float(x.mean()) if n else None
                sd = float(np.sqrt(np.sum(x * (1 - x))) / n) if n else None
                m[side] = {'expected_share': mean, 'conditional_choice_sd': sd,
                           'simulation_95_envelope': [max(0, mean-1.96*sd), min(1, mean+1.96*sd)] if n else None}
            m['difference'] = m['candidate']['expected_share'] - m['baseline']['expected_share'] if n else None
            modes[str(mode)] = m
        rows.append({'stratum': label, 'n': n, 'status': 'available' if n else 'empty', 'modes': modes})
    crossed = sum(r['n'] for r in rows if '/' in r['stratum'])
    if crossed != len(strata):
        raise ValueError('strata census mismatch')
    return rows


def native_stage(bundle: Path, stock: Path, overlay: Path, output: Path, mode_only: bool):
    import numpy as np
    import pandas as pd
    from activitysim import abm  # noqa: F401
    from activitysim.core import workflow, logit
    state = workflow.State.make_default(
        configs_dir=(overlay, bundle / 'configs', stock), data_dir=(bundle,), output_dir=output)
    state.logging.config_logger(basic=True)
    models = list(state.settings.models)
    prefix = models[:models.index(STOP)+1]
    if not mode_only:
        state.run(prefix)
        state.checkpoint.close_store()
        return
    captures = []
    original = logit.make_choices
    def capture(s, probs, trace_label=None, **kwargs):
        if s.get_rn_generator().step_name == MODE:
            check_probabilities(probs)
            captures.append(probs.copy())
        return original(s, probs, trace_label=trace_label, **kwargs)
    logit.make_choices = capture
    try:
        state.run([MODE], resume_after=STOP)
        probabilities = pd.concat(captures).sort_index()
        tours = state.get_dataframe('tours')
        people = state.get_dataframe('persons_merged')
        check_probabilities(probabilities, tours.index)
        attrs = tours.join(people[['auto_ownership', 'num_workers', 'is_university']], on='person_id')
        auto = np.where(attrs.auto_ownership == 0, 'no_auto',
                        np.where(attrs.auto_ownership < attrs.num_workers, 'auto_deficient', 'auto_sufficient'))
        purpose = attrs.tour_type.astype(str).where(~((attrs.tour_type == 'school') & attrs.is_university), 'univ')
        strata = pd.DataFrame({'purpose': purpose, 'auto_class': auto,
                               'category': np.where(attrs.tour_category == 'joint', 'joint', 'individual')}, index=tours.index)
        # Scratch only: no chooser IDs or per-person probabilities enter publication.
        probabilities.to_pickle(output / 'probabilities.pkl')
        strata.to_pickle(output / 'strata.pkl')
        tours.drop(columns=['tour_mode', 'mode_choice_logsum'], errors='ignore').sort_index().to_pickle(output / 'fixed_tours.pkl')
        state.checkpoint.close_store()
    finally:
        logit.make_choices = original


def verify_environment(stock: Path, environment_path: Path):
    from prepare_activitysim_walk_transfer import environment_manifest
    from activitysim_mtc_inputs import stock_configs_digest
    if environment_manifest() != json.loads(environment_path.read_text()):
        raise ValueError('runtime environment changed')
    inventory = json.loads((ROOT / 'docs/modeling/activitysim-coefficients-2026-10-23/stock-files.json').read_text())
    if stock_configs_digest(stock) != inventory['stock_digest']:
        raise ValueError('stock directory changed')


def extract_bundle(archive: Path, bundle: Path):
    from prepare_activitysim_walk_transfer import BUNDLE_FILES
    with zipfile.ZipFile(archive) as z:
        if set(z.namelist()) != set(BUNDLE_FILES) or len(z.namelist()) != len(BUNDLE_FILES):
            raise ValueError('unexpected archive members')
        z.extractall(bundle)


def check_frozen_candidate(transferred: dict, frozen: dict, coefficients: Path):
    if transferred != frozen or digest(coefficients) != frozen['files']['tour_mode_choice_coefficients.csv']:
        raise ValueError('frozen candidate differs')


def check_native_exit(returncode: int, label: str):
    if returncode:
        raise RuntimeError(f'native stage failed: {label}, exit {returncode}')


def check_fixed_inputs(baseline, candidate, replay):
    if not baseline.equals(candidate) or not baseline.equals(replay):
        raise ValueError('held-fixed inputs changed')


def execute(archive: Path, scratch: Path, stock: Path, candidate: Path, result_path: Path, study_id: str):
    import pandas as pd
    import yaml
    from activitysim_accepted_components import install_accepted_components
    verify_environment(stock, scratch.parent / 'environment.json')
    bundle = scratch / 'bundle'
    bundle.mkdir()
    extract_bundle(archive, bundle)
    base_overlay = scratch / 'baseline-configs'
    base_overlay.mkdir()
    install_accepted_components(base_overlay)
    settings = {'inherit_settings': True, 'rng_base_seed': 0, 'households_sample_size': 0,
                'multiprocess': False, 'sharrow': False, 'checkpoints': True,
                'chunk_size': 0, 'chunk_training_mode': 'disabled'}
    (base_overlay / 'settings.yaml').write_text(yaml.safe_dump(settings))
    c_overlay = scratch / 'candidate-configs'
    transferred = build_overlay(stock, c_overlay, NAME)
    # Confirm the frozen package and freshly built overlay agree exactly.
    frozen = json.loads((candidate / 'coefficient-set.json').read_text())
    check_frozen_candidate(transferred, frozen, c_overlay / 'tour_mode_choice_coefficients.csv')
    for f in base_overlay.iterdir():
        shutil.copy2(f, c_overlay / f.name)
    commands = []
    def run(label, overlay, mode_only):
        out = scratch / label
        out.mkdir()
        if mode_only:
            for p in (scratch / 'upstream').glob('pipeline*'):
                if p.is_dir(): shutil.copytree(p, out / p.name)
                else: shutil.copy2(p, out / p.name)
        cmd = [sys.executable, str(Path(__file__).resolve()), 'native', str(bundle), str(stock), str(overlay), str(out), str(int(mode_only))]
        with (scratch / (label + '.log')).open('wb') as log:
            r = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
        commands.append({'stage': label, 'exit_code': r.returncode, 'log_sha256': digest(scratch / (label + '.log'))})
        check_native_exit(r.returncode, label)
        return out
    run('upstream', base_overlay, False)
    b = run('baseline', base_overlay, True)
    c = run('candidate', c_overlay, True)
    r = run('replay', base_overlay, True)
    for filename in ('strata.pkl', 'fixed_tours.pkl'):
        ref = pd.read_pickle(b / filename)
        check_fixed_inputs(ref, pd.read_pickle(c / filename), pd.read_pickle(r / filename))
    rows = compare(pd.read_pickle(b / 'probabilities.pkl'), pd.read_pickle(c / 'probabilities.pkl'),
                   pd.read_pickle(r / 'probabilities.pkl'), pd.read_pickle(b / 'strata.pkl'))
    result = {'schema_version': SCHEMA, 'study_id': study_id, 'decision': 'inconclusive',
              'development_disposition': 'retire', 'reason': 'matched_observed_tour_modes_unavailable',
              'coefficient_set': NAME, 'candidate_sha256': digest(candidate / 'tour_mode_choice_coefficients.csv'),
              'source_archive_sha256': digest(archive), 'native_stages': commands,
              'observed_mode_log_loss': None, 'observation_uncertainty': None, 'coefficient_uncertainty': None,
              'uncertainty_scope': 'conditional independent simulated choices only; no survey or coefficient uncertainty',
              'checks': {'complete_coverage': True, 'probability_conservation': True, 'fixed_inputs': True,
                         'joint_unchanged': True, 'baseline_replay_identical': True}, 'strata': rows}
    validate(result)
    result_path.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')


def validate(value: dict):
    if value.get('schema_version') != SCHEMA or value.get('decision') != 'inconclusive' or value.get('development_disposition') != 'retire':
        raise ValueError('unsupported advancement')
    if value.get('reason') != 'matched_observed_tour_modes_unavailable' or any(value.get(k) is not None for k in ('observed_mode_log_loss', 'observation_uncertainty', 'coefficient_uncertainty')):
        raise ValueError('invented observation evidence')
    expected = {'complete_coverage', 'probability_conservation', 'fixed_inputs', 'joint_unchanged', 'baseline_replay_identical'}
    if set(value.get('checks', {})) != expected or not all(v is True for v in value['checks'].values()):
        raise ValueError('incomplete engineering checks')
    rows = value.get('strata', [])
    if len(rows) != 1+len(PURPOSES)+len(AUTO_CLASSES)+len(PURPOSES)*len(AUTO_CLASSES)*2:
        raise ValueError('missing strata')
    if rows[0]['stratum'] != 'all' or rows[0]['n'] <= 0 or sum(x['n'] for x in rows if '/' in x['stratum']) != rows[0]['n']:
        raise ValueError('aggregate census mismatch')
    for row in rows:
        for side in ('baseline', 'candidate'):
            shares = [x[side]['expected_share'] for x in row['modes'].values()]
            if row['n'] and (not all(isinstance(x, (float, int)) and math.isfinite(x) and 0 <= x <= 1 for x in shares)
                             or abs(sum(shares)-1) > 1e-8):
                raise ValueError('aggregate probability conservation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['native', 'evaluate', 'validate', 'package'])
    parser.add_argument('paths', nargs='+')
    args = parser.parse_args()
    if args.action == 'native':
        bundle, stock, overlay, output, mode = args.paths
        native_stage(*map(Path, (bundle, stock, overlay, output)), bool(int(mode)))
    elif args.action == 'evaluate':
        archive, scratch, stock, candidate, result, study_id = args.paths
        execute(*map(Path, (archive, scratch, stock, candidate, result)), study_id)
    elif args.action == 'validate':
        validate(json.loads(Path(args.paths[0]).read_text()))
    else:
        build_overlay(Path(args.paths[0]), Path(args.paths[1]), NAME)

if __name__ == '__main__':
    main()
