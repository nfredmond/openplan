"""Mutation checks for the admitted writer's local source registration boundary."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'workers/aequilibrae_worker/model_attempt_writer.py'
original = source.read_text()
start = original.index('    def retain_validation_sources(')
end = original.index('    def retain_package(', start)
section = original[start:end]
mutations = [
    ('stop-on-failure', '            self.stopped = True', '            self.stopped = False'),
    ('owned-attempt', 'if any(not Path(path).resolve(strict=True).is_relative_to(self.files.path)', 'if any(False'),
    ('artifact-type', "'artifact_type': 'model_validation_sources'", "'artifact_type': 'wrong_sources'"),
    ('method-metadata', "'context': context, 'publication_state'", "'context': {**context, 'method': 'wrong'}, 'publication_state'"),
    ('publication-claim', "'publication_state': 'retained_locally'", "'publication_state': 'published'"),
]
variants = [('harmless', original + '\n# Harmless formatting control.\n')]
for name, before, after in mutations:
    assert section.count(before) == 1, name
    variants.append((name, original[:start] + section.replace(before, after) + original[end:]))
variants.append(('restored', original))
cases = []
try:
    for name, content in variants:
        source.write_text(content)
        result = subprocess.run([sys.executable, '-B', 'workers/aequilibrae_worker/test_model_validation_source_writer.py'],
                                cwd=ROOT, capture_output=True, text=True, timeout=60)
        detail = result.stdout + result.stderr
        if name in ('harmless', 'restored'):
            assert result.returncode == 0, detail
        else:
            assert result.returncode != 0 and 'AssertionError' in detail, detail
        cases.append({'control': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    source.write_text(original)
report = {'source_sha256': hashlib.sha256(original.encode()).hexdigest(), 'cases': cases,
          'limits': 'Real local files and retained commands with injected HTTP. No native registration or recovery, Storage publication, normal dispatch or scientific acceptance.'}
Path(__file__).with_name('source-writer-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
