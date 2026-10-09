"""Falsify exact preparation preflight guards without executing a database command."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
script = ROOT / 'prepare_recovery_acceptance_database.py'
source = script.read_text()
# Stop before the first external command. This proves preflight ownership only.
prefix = source[:source.index('head = subprocess.check_output')]
owner = "if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):"
checkout = "if not checkout.name.startswith('recovery-acceptance-') or not (checkout/'openplan/supabase/config.toml').is_file():"
assert prefix.count(owner) == prefix.count(checkout) == 1


def exercise(candidate):
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        accepted = root / 'recovery-acceptance-test'
        config = accepted / 'openplan/supabase/config.toml'
        config.parent.mkdir(parents=True)
        config.write_text('')
        metadata = root / 'source.json'
        valid = {'container': 'supabase_db_openplan-restore-target-2026091050', 'database': 'openplan_retention_upgrade_'+'a'*32}
        for label, record, target, error in [
            ('owned', valid, accepted, None),
            ('foreign-container', {**valid, 'container': 'other'}, accepted, 'Foreign source accepted'),
            ('preview-database', {**valid, 'database': 'postgres'}, accepted, 'Preview database accepted'),
            ('foreign-checkout', valid, root / 'other', 'Foreign checkout accepted'),
        ]:
            metadata.write_text(json.dumps(record))
            environment = {'OPENPLAN_MODEL_COMMAND_PROOF_METADATA': str(metadata), 'OPENPLAN_RECOVERY_ACCEPTANCE_CHECKOUT': str(target), 'OPENPLAN_RECOVERY_ACCEPTANCE_OUTPUT': str(root / 'output')}
            old_mask = os.umask(0o077)
            try:
                with patch.dict(os.environ, environment), patch.object(subprocess, 'check_output', side_effect=AssertionError('Preflight reached an external command')):
                    try:
                        exec(compile(candidate, str(script), 'exec'), {'__file__': str(script)})
                    except ValueError:
                        if error is None:
                            raise AssertionError('Valid preflight refused')
                    else:
                        if error:
                            raise AssertionError(error)
            finally:
                os.umask(old_mask)


records = []
for name, candidate, failure in [
    ('baseline', prefix, None), ('harmless', prefix+'\n# Harmless comment.\n', None),
    ('omit-template-ownership', prefix.replace(owner, 'if False:'), 'Foreign source accepted'),
    ('omit-checkout-ownership', prefix.replace(checkout, 'if False:'), 'Foreign checkout accepted'),
    ('restored', prefix, None),
]:
    try:
        exercise(candidate)
    except AssertionError as error:
        if failure is None or str(error) != failure:
            raise
    else:
        if failure:
            raise AssertionError('Targeted ownership fault survived')
    records.append({'control': name, 'expected_failure': failure})
report = {'script_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': records, 'limits': 'Exact source preflight before any external command. Does not prove Git ownership, idle sessions, migrations, row preservation, RPC authority or a browser journey; those require live evidence.'}
(ROOT/'acceptance-preflight-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
