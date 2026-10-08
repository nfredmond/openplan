"""Prove legacy artifact command retry and rollback in the named owned database."""
from pathlib import Path
import json
import os
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent


def check(source_path=None):
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select the named owned proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    source_file = Path(source_path).resolve() if source_path else ROOT/'legacy-artifact-command.sql'
    source = source_file.read_text()
    cases = (ROOT/'legacy-artifact-command-cases.sql').read_text()
    faults = [
        ('changed-request', 'IF saved.request_payload IS DISTINCT FROM request THEN', 'IF false THEN', 'Changed artifact request accepted'),
        ('wrong-retry', 'RETURN saved.response_payload;', "RETURN '{}'::jsonb;", 'Artifact retry changed or duplicated'),
        ('existing-row', 'IS DISTINCT FROM p_payload THEN', 'IS DISTINCT FROM p_payload AND false THEN', 'Mismatched legacy artifact adopted'),
        ('stopped-run', "IF parent.status IN('failed','cancelled') THEN", 'IF false THEN', 'Stopped artifact accepted'),
        ('workspace', 'IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace THEN', 'IF false THEN', 'Wrong workspace accepted'),
        ('private-table', 'REVOKE ALL ON public.model_legacy_artifact_receipts FROM PUBLIC,anon,authenticated,service_role;', 'REVOKE ALL ON public.model_legacy_artifact_receipts FROM PUBLIC,anon,authenticated; GRANT INSERT ON public.model_legacy_artifact_receipts TO service_role;', 'Artifact command privileges exposed'),
    ]
    variants = [('baseline', source, None), ('harmless', source+'\n-- Harmless command comment.\n', None)]
    for name, before, after, error in faults:
        if source.count(before) != 1:
            raise AssertionError('Mutation anchor is not unique: '+name)
        variants.append((name, source.replace(before, after, 1), error))
    variants.append(('restored', source, None))
    command = ['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1']
    results = []
    for name, candidate, error in variants:
        script = "BEGIN; SET LOCAL openplan.proof_fixture='"+fixture+"';\n"+candidate+'\n'+cases+'\nROLLBACK;'
        result = subprocess.run(command, input=script, text=True, capture_output=True, timeout=30)
        if error is None:
            if result.returncode or 'legacy-artifact-command:' not in result.stderr:
                raise AssertionError(name+': '+result.stderr)
        elif result.returncode == 0 or error not in result.stderr:
            raise AssertionError(name+': '+result.stderr)
        results.append({'case': name, 'exit': result.returncode, 'expected_error': error})
    probe = subprocess.run(command, input="SELECT to_regclass('public.model_legacy_artifact_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_artifact(uuid,jsonb)') IS NULL;", text=True, capture_output=True, timeout=20)
    if probe.returncode or probe.stdout.strip() != 't':
        raise AssertionError('Artifact command rollback cleanup not confirmed')
    evidence = {'source_file': str(source_file), 'cases': results, 'rollback_cleanup_confirmed': True, 'scope': 'Actual database RPC and constraints, synthetic artifacts, rollback-only candidate. No installed migration, concurrency, HTTP, Storage bytes, retained client, normal dispatcher recovery or scientific acceptance.'}
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    (output/'legacy-artifact-command.json').write_text(json.dumps(evidence, indent=2)+'\n')
    return evidence


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    print(json.dumps(check(parser.parse_args().source), indent=2))
