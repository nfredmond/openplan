"""Join native preparation consumption and initial-input profile registration.

Both methods use synthetic solver objects. Native transactions prove custody,
not AequilibraE execution or ActivitySim behavior.
"""
import json
import os
from pathlib import Path
from unittest.mock import patch

import verify_native_preparation_handoff as handoff
import assignment_settings
import model_assignment_input_snapshot as snapshot
import model_attempt_writer as managed
import test_assignment_input_snapshot as inputs

control = os.environ.get('OPENPLAN_PREPARATION_PROFILE_CONTROL', 'baseline')
assert control in ('baseline', 'harmless', 'mismatch', 'incomplete', 'restored', 'skip-comparison',
                  'network-mismatch', 'network-metadata', 'skip-network-comparison')
with patch.object(assignment_settings, 'installed_assignment_engine_version', return_value='1.6.2'):
    profile = assignment_settings.resolve_assignment_profile({'AEQ_CORES': '1'})
results = []


def configure(arguments):
    content = {} if control == 'incomplete' else profile
    arguments['assignment_profile_path'].write_text(json.dumps(content, indent=2 if control == 'harmless' else None))
    from test_assignment_network_source import prepare_fixture
    prepare_fixture(arguments)


def verify(writer, method, consumption, sql, database):
    fixture = inputs.SnapshotTests(); fixture.setUp()
    try:
        current = dict(profile)
        expected_refusal = control in ('mismatch', 'incomplete', 'skip-comparison', 'network-mismatch', 'skip-network-comparison')
        if control in ('mismatch', 'skip-comparison'): current['target_gap'] /= 2
        fixture.engine.rgap_target = current['target_gap']
        fixture.engine.max_iter = current['max_iterations']
        fixture.engine.assignment.rgap_target = current['target_gap']
        fixture.engine.assignment.max_iter = current['max_iterations']
        output = writer.files.path / 'run_output'; output.mkdir()
        def execute():
            import shutil
            manifest=json.loads(Path(consumption['file_url'].removeprefix('local://')).read_text())
            network=next(entry for entry in manifest['entries'] if entry['role']=='network')
            origin=Path(consumption['file_url'].removeprefix('local://')).parent/network['object_name']
            working=writer.files.path/'assignment-network.sqlite';shutil.copyfile(origin,working)
            import sqlite3
            with sqlite3.connect(working) as connection:
                if control in ('network-mismatch','skip-network-comparison'):
                    connection.execute('UPDATE links SET capacity_ab=999')
                elif control=='network-metadata':
                    connection.execute('CREATE TABLE operator_notes(note TEXT)')
                    connection.execute("INSERT INTO operator_notes VALUES('harmless metadata')")
            with managed.bind(writer):
                snapshot.retain_and_execute(fixture.engine,
                    directory=output/'initial_assignment_inputs',
                    context={'run_id':writer.context.run_id,'stage_id':writer.context.stage_id,'demand_method':method},
                    profile=current,network_state={},network_settings={},network_database=working)
        if control in ('skip-comparison','skip-network-comparison'):
            import model_assignment_preparation_link as link
            source = Path(link.__file__).read_text()
            guard='if prepared != current:' if control=='skip-comparison' else 'if prepared_network != network_source:'
            assert source.count(guard) == 1
            exec(compile(source.replace(guard, 'if False:'), link.__file__, 'exec'), link.__dict__)
        refusal = None
        try: execute()
        except ValueError as error:
            refusal = str(error)
            if not expected_refusal: raise
            expected = 'fields do not match' if control == 'incomplete' else 'Prepared assignment profile differs'
            if control in ('network-mismatch','skip-network-comparison'):expected='Prepared network source differs'
            assert expected in refusal, refusal
        rows=json.loads(sql(database,f"SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.model_run_artifacts a WHERE stage_id='{writer.context.stage_id}' AND artifact_type='model_initial_assignment_inputs';"))
        if expected_refusal:
            assert refusal is not None, 'Prepared input defect reached assignment without refusal'
            assert not rows, 'Refused profile registered initial assignment'
            fixture.engine.execute.assert_not_called()
            assert writer.stopped, 'Profile refusal did not stop writer'
        else:
            assert len(rows) == 1, 'Initial input registration missing'
            record = rows[0]['metadata_json']['preparation_link']
            assert record['artifact_id'] == consumption['id'], 'Preparation artifact identity differs'
            assert record['assignment_profile']['canonical_sha256'] == assignment_settings.assignment_profile_digest(profile)
            assert record['assignment_profile']['status'] == 'matched'
            assert record['assignment_profile']['scope'] == 'declared_assignment_profile'
            assert record['solver_input_equivalence'] == 'unassessed'
            assert record['network_source']['status']=='matched'
            assert record['network_source']['scope']=='source_node_link_records'
            fixture.engine.execute.assert_called_once()
        results.append({'method':method,'registered':not expected_refusal,'refused':refusal,
                        'scientific_acceptance':'unassessed','solver':'synthetic'})
    finally: fixture.doCleanups()


handoff.configure_inputs = configure
handoff.after_consumption = verify
handoff.main()
report = {'control': control, 'results': results,
    'limits': 'Native claims, completed producer, consumption and initial-input artifact transactions. Synthetic solver and preparation inputs; no native engine behavior or scientific acceptance.'}
(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])/'profile-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
