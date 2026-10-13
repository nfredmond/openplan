"""Bounded ZIP engine controls with exact source restoration."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def replace(value, before, after):
    if value.count(before) != 1: raise ValueError('Draft control anchor must be unique')
    return value.replace(before, after, 1)


def guard(value, message):
    lines = value.splitlines(keepends=True)
    hits = [i for i, line in enumerate(lines) if "raise ValueError('"+message+"')" in line]
    if len(hits) != 1: raise ValueError('Draft guard anchor must be unique')
    index = hits[0]-1;lines[index] = lines[index][:len(lines[index])-len(lines[index].lstrip())]+'if False:\n'
    return ''.join(lines)


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    paths = {'library': repo/'workers/odm_worker/draft_custody.py', 'engine': repo/'workers/odm_worker/engine_effects.py'}
    originals = {key: path.read_bytes() for key, path in paths.items()}
    tests = repo/'workers/odm_worker/test_zip_engine.py';test_bytes = tests.read_bytes()
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, source='library', kind='broken_behavior'):
        cases.append((label, test, transform, reason, source, kind))
    def swap(before, after): return lambda value: replace(value, before, after)
    def disable(message): return lambda value: guard(value, message)
    add('zip-format-lost', 'test_zip_plan_binds_original_lineage_and_ordered_slots', swap("'format': ZIP_FORMAT if custody is not None else FORMAT", "'format': FORMAT"), 'ZIP plans need a distinct original format', source='engine')
    add('derived-hash-lost', 'test_zip_plan_binds_original_lineage_and_ordered_slots', swap("'sourceManifestSha256': receipt['manifestSha256']", "'sourceManifestSha256': '0'*64"), 'Actual retained engine source identity differs', source='engine', kind='diagnostic_refusal')
    add('raw-lineage-lost', 'test_zip_plan_binds_original_lineage_and_ordered_slots', swap("plan['sourceCustody'] = custody", "plan['sourceCustody'] = {}"), 'original raw and derived lineage must remain', source='engine')
    add('wrong-upload-source', 'test_zip_plan_binds_original_lineage_and_ordered_slots', swap("'multipart': {'field': 'images', **row}", "'multipart': {'field': 'images', **row, 'objectRelativePath': 'objects/source-00000.bin'}"), 'upload must use derived slot', source='engine')
    add('raw-zip-guard-diagnostic', 'test_raw_zip_never_becomes_upload', disable('ZIP source requires original derived-image custody'), 'does not match', source='engine', kind='diagnostic_refusal')
    add('invalid-zip-lineage', 'test_lineage_shape_hashes_and_archive_types_refuse', disable('ZIP derived-image lineage is required'), 'ValueError not raised', source='engine')
    add('empty-zip-slots', 'test_empty_or_invalid_slot_mapping_refuses', disable('ZIP derived-image slots are required'), 'does not match', source='engine', kind='diagnostic_refusal')
    add('invalid-zip-slot-mapping', 'test_empty_or_invalid_slot_mapping_refuses', disable('ZIP derived-image slot mapping differs'), 'ValueError not raised', source='engine')
    add('unsafe-zip-member', 'test_member_path_filename_and_order_refuse', disable('ZIP derived-image member or filename differs'), 'does not match', source='engine', kind='mixed_target_failures')
    add('changed-zip-member-order', 'test_member_path_filename_and_order_refuse', disable('ZIP derived-image member order differs'), 'ValueError not raised', source='engine')
    add('renamed-derived-upload', 'test_caller_cannot_rename_derived_uploads', disable('ZIP original derived filenames must be preserved'), 'ValueError not raised', source='engine')
    add('unknown-derivation-arguments', 'test_exact_derivation_arguments_and_root_overlap_refuse', disable('Exact ZIP derivation arguments are required'), 'Invalid derivation arguments reached source intake', source='engine', kind='mixed_target_failures')
    add('overlapping-derived-journal', 'test_exact_derivation_arguments_and_root_overlap_refuse', disable('Engine journal and derived image roots must not overlap'), 'ValueError not raised', source='engine', kind='mixed_target_failures')
    add('photo-derivation-bypassed', 'test_photo_cannot_claim_zip_derivation', swap('return derived_zip.prepare(arguments, **self.derived_arguments, timeout=remaining)', 'return prepare(**arguments)'), 'Non-ZIP derivation reached engine plan', source='engine')
    add('actual-zip-byte-recheck-omitted', 'test_every_operation_rechecks_actual_zip_and_image_bytes', swap('        receipt = self._source_receipt(end)\n        if receipt[', '        receipt = {"manifestSha256": self.plan["sourceManifestSha256"]}\n        if receipt['), 'ValueError not raised', source='engine')
    add('derived-receipt-ignored', 'test_derived_receipt_change_refuses_before_intent', disable('Actual retained engine source identity differs'), 'ValueError not raised', source='engine')
    add('caller-derivation-alias', 'test_caller_derivation_mutation_does_not_change_original', swap('self.derived_arguments = dict(derived_arguments)', 'self.derived_arguments = derived_arguments'), 'expanded byte budget', source='engine', kind='diagnostic_refusal')
    add('uncertain-zip-command-reissued', 'test_stopped_copy_preserves_unresolved_commands_and_missing_slot_recovery', swap('not existed\n', 'True\n'), 'uncertain ZIP upload must not issue again', source='engine')
    add('draft-lineage-shape-ignored', 'test_draft_plan_shape_and_zip_source_identity_refuse', disable('Original ZIP source custody shape differs'), 'does not match', kind='diagnostic_refusal')
    add('draft-zip-source-type-ignored', 'test_draft_plan_shape_and_zip_source_identity_refuse', disable('Original ZIP plan requires ZIP imagery'), 'does not match', kind='diagnostic_refusal')
    add('draft-zip-permission-promoted', 'test_captured_zip_draft_compares_actual_bytes_without_permission', swap("'transportPermission': False", "'transportPermission': True"), 'ZIP byte comparison cannot authorize transport')
    add('draft-zip-byte-comparison-omitted', 'test_captured_zip_draft_compares_actual_bytes_without_permission', disable('Captured draft upload differs from original bytes'), 'ValueError not raised')
    if {row[1] for row in cases} != census: raise ValueError('New draft tests lack controls')
    outcomes = []
    def restore():
        for key, path in paths.items(): path.write_bytes(originals[key])
    def execute(label, test=None):
        cwd = out/(label+'-cwd');cwd.mkdir(mode=0o700)
        result = subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []), cwd=cwd,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}, capture_output=True, timeout=15)
        output = (result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode, output
    def positive(label, harmless=False):
        restore()
        if harmless:
            for key, path in paths.items(): path.write_bytes(originals[key]+b'\n# Harmless draft inspection control.\n')
        code, output = execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output: raise AssertionError(label+': baseline failed')
        outcomes.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline');positive('harmless-comments', True);positive('restored-after-harmless')
        for label, test, transform, reason, source, kind in cases:
            try:
                changed = transform(originals[source].decode());ast.parse(changed);paths[source].write_text(changed)
                code, output = execute(label, test)
                if code == 0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output): raise AssertionError(label+': target did not fail')
                lines = output.splitlines();starts = [i for i, line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:', line)]
                diagnostic = ''
                if starts:
                    end = next((i for i in range(starts[-1]+1,len(lines)) if lines[i].startswith('-----')),len(lines))
                    diagnostic = '\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic: raise AssertionError(label+': wrong diagnostic '+repr(diagnostic))
                outcomes.append({'control':label,'test':test,'source':source,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally: restore()
        positive('restored-final')
        if tests.read_bytes() != test_bytes or any(path.read_bytes() != originals[key] for key, path in paths.items()): raise AssertionError('Draft source or tests changed')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*paths.values(),tests]},indent=2)+'\n')
        print(json.dumps({'controls':len(outcomes),'positive':4,'broken':len(cases),'testsCovered':len(census)}))
    finally:
        restore()
        for path in paths.values():
            with path.open('rb') as stream: os.fsync(stream.fileno())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True);args = parser.parse_args();run(args.repo.resolve(),args.out.absolute())
