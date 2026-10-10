"""Run the existing native controls through an owned loopback HTTP gateway."""
import json
import os
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'docs/reviews/2026-10-08-model-custody-metadata/prototype'))
from isolated_postgrest import gateway
config = json.loads(Path(sys.argv[1]).read_text())
assert config['container'] == os.environ['OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER']
owner = '13466ed2-dcb7-4861-a528-68cc5579eea9'
viewer = '7a50d4fb-35b7-41f4-9bce-8a4e7d157569'
with gateway(config['schema'], database=config['database'], subjects=(owner, viewer)) as rest:
    env = {**os.environ, 'OPENPLAN_PROOF_HTTP_URL': rest['url'],
        'OPENPLAN_PROOF_OWNER_TOKEN': rest['authenticated_tokens'][owner],
        'OPENPLAN_PROOF_VIEWER_TOKEN': rest['authenticated_tokens'][viewer]}
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('verify_native_controls.py')), sys.argv[1]],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError('HTTP native controls failed: ' + result.stderr)
    print(result.stdout)
