"""Relocate fixture writes before loading the supplied test campaigns."""
import os
import shutil
import sys
from common import OUT, V2, PUBLIC

os.umask(0o077)
which = sys.argv[1]
if which == 'prepare':
    for name in ['app_binding_v1.py', 'attest_start_v1.py', 'binding-private.json',
                 'app-env-private.json', 'app-v1.env', 'migrations.json',
                 'dependency-binding.json', 'recovery-active-binding.json']:
        shutil.copyfile(V2/name, OUT/name)
        (OUT/name).chmod(0o600)
    raise SystemExit(0)
filename = {'consumer': 'verify_controls.py', 'attestation': 'verify_attestation.py',
            'small': 'verify_small_guards.py', 'boundary': 'verify_boundary.py',
            'composition': 'verify_composition.py'}[which]
source = (PUBLIC/filename).read_text().replace(str(V2), str(OUT))
if which == 'attestation':
    old = "text=(PUBLIC/'verify_controls.py').read_text().split('\\nrows=campaign(m)\\n')[0]"
    assert source.count(old) == 1
    source = source.replace(old, old + '.replace(' + repr(str(V2)) + ',' + repr(str(OUT)) + ')')
if which == 'small':
    old = "exec(compile(source,module.__file__,'exec'),module.__dict__)"
    assert source.count(old) == 1
    source = source.replace(old, old + '\n    module.ROOT=PRIVATE')
if which == 'composition':
    # Keep the real runner's root as its replacement needle. Only specimens,
    # input health JSON and output move; runner source bytes stay exact.
    source = source.replace('ROOT=Path(' + repr(str(OUT)) + ')', 'ROOT=Path(' + repr(str(V2)) + ')')
    source = source.replace("SPEC=ROOT/'composed-recipe-07'", "SPEC=Path(" + repr(str(OUT)) + ")/'composed-recipe-07'")
    source = source.replace("(ROOT/'actual-health-producer.json')", "(Path(" + repr(str(OUT)) + ")/'actual-health-producer.json')")
    source = source.replace("write(ROOT/'composed-controls-07.json'", "write(Path(" + repr(str(OUT)) + ")/'composed-controls-07.json'")
    source = source.replace('openplan-health-v2-composed07-', 'openplan-review-r2-composed01-')
scope = {'__file__': str(PUBLIC/filename), '__name__': 'independent_replay'}
exec(compile(source, str(PUBLIC/filename), 'exec'), scope)
