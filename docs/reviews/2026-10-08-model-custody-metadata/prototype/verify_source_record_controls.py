"""Detect omitted source verification at the real bundle-builder entry."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT/'scripts/modeling/validation_instrument_v2.py'
original = source.read_bytes()
mutations = (
    ('bypass-builder-check', 'sources = verified_source_artifacts(source_artifacts, relative_to=relative_to)', 'sources = list(source_artifacts)', 'test_changed_source_bytes_are_refused'),
    ('ignore-hash', 'if actual_hash != expected_hash or actual_size != expected_size:', 'if actual_size != expected_size:', 'test_changed_source_bytes_are_refused'),
    ('ignore-size', 'if actual_hash != expected_hash or actual_size != expected_size:', 'if actual_hash != expected_hash:', 'test_wrong_size_is_refused'),
    ('skip-unavailable', 'raise InstrumentV2Error("Source artifact is unavailable")', 'continue', 'test_missing_file_and_directory_are_refused'),
    ('skip-malformed', 'raise InstrumentV2Error("Source artifact requires an exact path, hash and byte size")', 'continue', 'test_malformed_records_are_refused'),
    ('skip-nonrecord', 'raise InstrumentV2Error("Source artifact must be a record")', 'continue', 'test_malformed_records_are_refused'),
    ('accept-nonsequence', 'raise InstrumentV2Error("Source artifacts must be a sequence of records")', 'return []', 'test_malformed_collection_is_refused'),
    ('retain-mutable-record', 'verified.append(dict(record))', 'verified.append(record)', 'test_exact_source_and_empty_list_preserve_declared_content'),
)
cases = []
try:
    variants = [('harmless', original + b'\n# Harmless source-retention control.\n', None)]
    for name, old, new, test in mutations:
        assert original.count(old.encode()) == 1, name
        variants.append((name, original.replace(old.encode(), new.encode()), test))
    variants.append(('restored', original, None))
    for name, content, test in variants:
        source.write_bytes(content)
        command = [sys.executable, '-B', str(ROOT/'scripts/modeling/tests/test_validation_source_records.py')]
        if test: command.append('SourceRecordsTests.' + test)
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        detail = result.stdout + result.stderr
        if test:
            assert result.returncode != 0 and test in detail and 'AssertionError' in detail, detail
        else:
            assert result.returncode == 0, detail
        cases.append({'control': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_bytes(original)
report = {'cases': cases, 'source_sha256': hashlib.sha256(original).hexdigest(),
          'limits': ['Synthetic retained files through the real bundle builder',
                     'No source quality, observation lineage, filesystem race, independent freezing or scientific acceptance proof']}
Path(__file__).with_name('source-record-controls.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
