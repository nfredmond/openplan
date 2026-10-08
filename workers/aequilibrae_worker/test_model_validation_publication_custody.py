"""Keep the acknowledged database identity outside immutable assessment bytes."""
import ast
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from worker_import_for_tests import import_worker_main

main = import_worker_main()


def records():
    bundle = {'schema': 'openplan.validation-input-bundle.v1'}
    basis = {'schema': 'openplan.model-comparison-basis.v1'}
    assessment = {
        'schema': 'openplan.model-validation-assessment.v1', 'assessment_id': 'synthetic-file-identity',
        'rules_version': 4, 'scientific_outcome': 'inconclusive', 'planning_use': 'synthetic',
        'partition': {}, 'reasons': [], 'coverage': {}, 'metrics': {},
        'comparability_findings': [], 'exact_inputs': {}, 'legacy_point_count_diagnostic': {},
        'validation_evidence_write': 'pending',
    }
    return bundle, basis, assessment


class PublicationCustodyTests(unittest.TestCase):
    def exercise(self, caller, failed=False):
        bundle, basis, assessment = records()
        receipt = {'id': 'verified-database-row', 'partition_json': {'synthetic': True}}
        original = copy.deepcopy(assessment)
        if failed:
            assessment['validation_custody_receipt'] = {'id': 'stale-prior-row'}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(main, 'upload_immutable_validation_json', side_effect=lambda run, identity, path: 'storage://synthetic/' + Path(path).name), \
                 patch.object(main, 'sb_record_modeling_validation_assessment', side_effect=main.WorkerStateWriteUnconfirmed('synthetic uncertainty') if failed else None, return_value=receipt):
                if caller == 'behavioral_demand':
                    result = main.persist_rules_v4_validation_records(
                        run_id='synthetic-run', stage_id='synthetic-stage', workspace_id='synthetic-workspace',
                        track=caller, model_output_artifact_id='synthetic-output', record_dir=str(root/'records'),
                        validation_input_bundle=bundle, comparison_basis=basis, assessment=assessment)
                    path = root/'records'/'model_validation_assessment.json'
                else:
                    # Execute the actual assignment custody block, without a model run.
                    function = next(node for node in ast.parse(Path(main.__file__).read_text()).body
                                    if isinstance(node, ast.FunctionDef) and node.name == 'stage_artifacts')
                    blocks = [node for node in ast.walk(function) if isinstance(node, ast.Try)
                              and any(isinstance(statement, ast.Assign) and isinstance(statement.value, ast.Call)
                                      and isinstance(statement.value.func, ast.Name)
                                      and statement.value.func.id == 'sb_record_modeling_validation_assessment'
                                      for statement in node.body)]
                    self.assertEqual(len(blocks), 1)
                    paths = {}
                    for kind, value in [('validation_input_bundle', bundle), ('model_comparison_basis', basis), ('model_validation_assessment', assessment)]:
                        destination = root/(kind+'.json')
                        destination.write_text(main.model_validation_core.canonical_json(value))
                        paths[kind] = str(destination)
                    namespace = dict(vars(main), run_id='synthetic-run', stage_id='synthetic-stage',
                                     _ws_id='synthetic-workspace', model_output_artifact_id='synthetic-output',
                                     validation_input_bundle=bundle, comparison_basis=basis,
                                     validation_assessment=assessment, validation={'model_validation_assessment': assessment},
                                     validation_record_paths=paths, log='')
                    exec(compile(ast.Module(body=blocks, type_ignores=[]), main.__file__, 'exec'), namespace)
                    result = namespace['validation_assessment']
                    path = Path(paths['model_validation_assessment'])
                if failed:
                    self.assertEqual(result['validation_evidence_write'], 'validation evidence write failed')
                    self.assertNotIn('validation_custody_receipt', result)
                    return
                self.assertEqual(result['validation_custody_receipt'], receipt)
                self.assertEqual(result['validation_evidence_write'], 'recorded')
                self.assertEqual(json.loads(path.read_text()), original)
                receipt['partition_json']['synthetic'] = False
                self.assertIs(result['validation_custody_receipt']['partition_json']['synthetic'], True)
                publication = main.build_model_run_modeling_evidence('synthetic-run', 'synthetic-workspace', {
                    'validation_rules_version': 4, 'model_validation_assessment': result,
                }, track=caller)
                retained = publication['claim']['validation_summary_json']['model_validation_assessment']
                self.assertEqual(retained['validation_custody_receipt'], result['validation_custody_receipt'])

    def test_acknowledged_identity_survives_both_publication_callers(self):
        for caller in ('assignment', 'behavioral_demand'):
            with self.subTest(caller=caller):
                self.exercise(caller)

    def test_failed_custody_cannot_reuse_an_old_receipt(self):
        for caller in ('assignment', 'behavioral_demand'):
            with self.subTest(caller=caller):
                self.exercise(caller, failed=True)


if __name__ == '__main__':
    unittest.main()
