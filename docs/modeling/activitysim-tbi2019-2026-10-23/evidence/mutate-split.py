"""Run bounded split-source mutations, then restore exact source bytes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path.cwd()
source = root / 'scripts/modeling/tbi2019_development_split.py'
original = source.read_bytes()
original_sha = hashlib.sha256(original).hexdigest()
controls = [
 ('outcome_projection', 'test_outcome_field_refused', 'raise ValueError("roster must contain only the three outcome-free fields")', 'return []'),
 ('positive_id', 'test_invalid_id_refused', 'raise ValueError("household ID must be a positive integer")', 'return []'),
 ('duplicate_id', 'test_duplicate_refused', 'raise ValueError("duplicate household ID")', 'return []'),
 ('wave', 'test_wrong_wave_refused', 'raise ValueError("only the 2019 wave is admitted")', 'return []'),
 ('county_type', 'test_bad_county_refused', 'raise ValueError("county must be a publisher label or null")', 'return []'),
 ('split_hash', 'test_spec_tamper', 'raise ValueError("split specification hash mismatch")', 'return {}'),
 ('publisher_error', 'test_page_refusals', 'raise ValueError("publisher returned an error, not a roster page")', 'return []'),
 ('page_count', 'test_page_refusals', 'raise ValueError("roster page is empty, malformed or exceeds the frozen census")', 'return []'),
 ('response_projection', 'test_page_refusals', 'raise ValueError("publisher returned fields outside the outcome-free projection")', 'return []'),
 ('census_positive', 'test_invalid_census', 'raise ValueError("publisher household census is not a positive integer")', 'return'),
 ('census_stability', 'test_census_change', 'raise ValueError("publisher household census changed during acquisition")', 'return'),
 ('partition_fraction', 'test_exact_independent_rank_and_conservation', 'ranked[:len(ranked) // 5]', 'ranked[:len(ranked) // 4] + ranked[-1:]'),
 ('county_partition', 'test_county_stratification_and_missing', 'groups[county or "__missing__"].append(hid)', 'groups["Anoka County, MN"].append(hid)'),
 ('query_outcomes', 'test_query_projection', 'outFields="hh_id,home_county,survey_year"', 'outFields="*"'),
 ('query_order', 'test_query_projection', 'orderByFields="hh_id ASC"', 'orderByFields="hh_id DESC"'),
 ('summary_census', 'test_county_stratification_and_missing', '"households": n}', '"households": n + 1}'),
 ('overwrite_refusal', 'test_acquisition_end_to_end_synthetic', 'run.mkdir(parents=True, exist_ok=False)', 'if run.exists():\n        return\n    run.mkdir(parents=True, exist_ok=False)'),
]
records = []

def run(test=None):
    cmd = [sys.executable, '-B', '-m', 'unittest']
    if test:
        cmd += ['discover', '-s', 'scripts/modeling/tests', '-p', 'test_tbi2019_development_split.py', '-k', test, '-v']
    else:
        cmd += ['discover', '-s', 'scripts/modeling/tests', '-p', 'test_tbi2019_development_split.py', '-v']
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output = p.stdout + p.stderr
    return p.returncode, output.decode(), hashlib.sha256(output).hexdigest()

try:
    code, output, digest = run()
    if code: raise RuntimeError('baseline failed: ' + output)
    records.append(dict(name='baseline', exit_code=code, output_sha256=digest))
    source.write_bytes(original + b'\n# Harmless source comment for mutation control.\n')
    code, output, digest = run()
    if code: raise RuntimeError('harmless control failed: ' + output)
    records.append(dict(name='harmless_comment', exit_code=code, output_sha256=digest))
    for name, test, old, new in controls:
        text = original.decode()
        if text.count(old) != 1: raise RuntimeError('mutation anchor not unique: ' + name)
        source.write_text(text.replace(old, new))
        code, output, digest = run(test)
        if code != 1 or 'AssertionError' not in output or 'FAIL: ' + test not in output or 'ERROR:' in output:
            raise RuntimeError('unexpected mutation behavior: ' + name + '\n' + output)
        records.append(dict(name=name, test=test, exit_code=code, intended_assertion_failed=True,
                            output_sha256=digest,
                            assertion_lines=[l for l in output.splitlines() if 'AssertionError' in l]))
        source.write_bytes(original)
finally:
    source.write_bytes(original)
code, output, digest = run()
if code: raise RuntimeError('restoration failed: ' + output)
records.append(dict(name='restored', exit_code=code, output_sha256=digest))
print(json.dumps(dict(source_sha256=original_sha, restored_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                     tests=13, targeted_controls=len(controls), records=records), indent=2))
