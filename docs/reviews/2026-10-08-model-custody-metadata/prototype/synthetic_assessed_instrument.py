"""Synthetic evaluator-to-custody fixture, never observation or accuracy evidence."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'scripts/modeling/tests'))
from test_validation_instrument_v2 import core, observation, audit, basis


def prepare(directory, run, method, *, worker_wrapper=False):
    directory.mkdir()
    def write(name, value):
        path = directory / (name + '.json')
        path.write_text(core.canonical_json(value))
        return path
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()
    item = observation()
    package = write('observations', {'fixture': 'synthetic software-integrity input', 'observations': [item]})
    match = {'observation_id': item['observation_id'], 'status': 'matched',
             'selected_link_ids': ['a'], 'direction_aggregation': 'one_direction'}
    matched = audit(item, match)
    matched['observation_package_sha256'] = digest(package)
    audit_path = write('match_audit', matched)
    model_value = 100 if method == 'aequilibrae' else 120
    output = directory / 'output.csv'
    output.write_text(f'link_id,PCE_tot\na,{model_value}\n')
    comparison = basis(item, method)
    comparison['model_run_id'] = run
    comparison['model_output_artifact'] = {'path': output.name, 'sha256': digest(output)}
    basis_path = write('comparison_basis', comparison)
    bundle_path = write('input_bundle', {
        'schema': 'openplan.validation-input-bundle.v2', 'model_output_bytes_read': False,
        'fixture': 'Synthetic inputs; no source preparation or independent acceptance',
        'readiness_inputs': {'observation_package': {'path': package.name, 'sha256': digest(package)},
                             'pre_volume_match_audit': {'path': audit_path.name, 'sha256': digest(audit_path)}}})
    if worker_wrapper:
        # This authored fixture exercises transport, not independent preparation.
        from worker_import_for_tests import import_worker_main
        worker = import_worker_main()
        structural_core = worker.model_structural_input_audit
        source = directory/'synthetic-source.bin'
        source.write_bytes(b'Synthetic structural source; no real network or population')
        structural = {
            'schema': structural_core.AUDIT_SCHEMA, 'method': method,
            'geography': {'study_geometry': 'synthetic/opaque', 'authorities': ['fixture']},
            'frozen_before_model_output': True, 'model_output_bytes_read': False,
            'source_hashes': {'fixture_source': structural_core.artifact(source, root=directory)},
            'demand_distribution': {'row_column_difference': 0, 'unreachable_od_trips': 0},
            'network_loading_readiness': {'demand_removed_as_unreachable': 0,
                'facility_coverage': {'fixture': 1}, 'loadable_roadway_links': 1,
                'structurally_unreachable_roadway_links': 0},
            'external_and_through_travel': {'non_work_through_travel': 'unsupported',
                'through_share_evidence': 'unknown'},
        }
        structural_path = write('structural_audit', structural)
        bundle = json.loads(bundle_path.read_text())
        bundle['readiness_inputs']['structural_audit'] = {'path': structural_path.name, 'sha256': digest(structural_path)}
        write('input_bundle', bundle)
        assessment = worker.assess_rules_v5_validation_instrument(
            observation_package_path=str(package), pre_volume_match_audit_path=str(audit_path),
            validation_input_bundle_path=str(bundle_path), comparison_basis_path=str(basis_path),
            structural_input_audit_path=str(structural_path), link_volumes_csv=str(output),
            assessment_id='synthetic-' + method, readiness_root=str(directory),
            expected_model_run_id=run, expected_input_bundle_sha256=digest(bundle_path),
            expected_comparison_basis_sha256=digest(basis_path),
            expected_structural_audit_sha256=digest(structural_path), expected_method=method,
            expected_geography=structural['geography'], expected_structural_sources=structural['source_hashes'])
    else:
        assessment = core.assess_frozen_instrument_files(observation_package_path=package,
            pre_volume_match_audit_path=audit_path, validation_input_bundle_path=bundle_path,
            comparison_basis_path=basis_path, model_output_path=output, assessment_id='synthetic-' + method,
            readiness_root=directory)
    assert assessment['method'] == method and assessment['scientific_outcome'] == 'inconclusive'
    assert assessment['observation_results'][0]['modeled_value'] == model_value, 'Synthetic method value changed'
    assessment_path = write('assessment', assessment)
    diagnosis_path = write('diagnosis', {'schema': 'openplan.model-validation-structural-diagnosis.v2',
        'fixture': 'Synthetic custody fixture, not a diagnosed real model', 'method': method,
        'scientific_outcome': 'inconclusive', 'coverage': assessment['coverage'],
        'assessment_sha256': digest(assessment_path)})
    return {'model_output': output, 'input_bundle': bundle_path, 'match_audit': audit_path,
            'comparison_basis': basis_path, 'assessment': assessment_path, 'diagnosis': diagnosis_path}


def check_bindings(paths, method, run):
    def load(role): return json.loads(paths[role].read_text())
    def digest(role): return hashlib.sha256(paths[role].read_bytes()).hexdigest()
    assessment, comparison = load('assessment'), load('comparison_basis')
    assert comparison['model_run_id'] == run and comparison['method'] == assessment['method'] == method, 'Instrument scope differs'
    assert assessment['scientific_outcome'] == 'inconclusive', 'Synthetic outcome promoted'
    for key, role in (('validation_input_bundle_sha256', 'input_bundle'), ('match_audit_sha256', 'match_audit'), ('model_output_sha256', 'model_output')):
        assert assessment['exact_inputs'][key] == digest(role), 'Evaluated bytes differ from publication bytes'
    assert comparison['model_output_artifact']['sha256'] == digest('model_output'), 'Comparison output hash differs'
    assert assessment['exact_inputs']['comparison_basis_sha256'] == core.sha256_payload(comparison), 'Comparison logical hash differs'
    assert load('diagnosis')['assessment_sha256'] == digest('assessment'), 'Diagnosis assessment hash differs'
