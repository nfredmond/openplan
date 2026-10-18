"""Exercise all single-wrapper entry branches using harmless owned payloads."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
from common import PUBLIC, V2, OUT, write

os.umask(0o077)
base = (PUBLIC/'run_stage_v2.sh').read_bytes()
root = OUT/'entry-specimens'; root.mkdir(mode=0o700)
payload = r'''
import json, os
from pathlib import Path
root = Path(__file__).parent
assert os.environ['PATH'] == '/usr/bin:/bin', 'entry-PATH'
assert os.environ['HOME'] == str(root/'home'), 'entry-HOME'
assert not any(k in os.environ for k in ['PYTHONPATH','OPENAI_API_KEY','HTTP_PROXY','DOCKER_HOST','BASH_ENV','ENV']), 'entry-ambient'
assert not (root/'interpreter-trap').exists(), 'entry-interpreter-trap'
assert os.readlink('/proc/self/ns/net') == (root/'parent-net').read_text(), 'entry-network-scope'
with (root/'child.json').open('x') as f:
    json.dump({'branch': (root/'branch').read_text(), 'environmentKeys': sorted(os.environ)}, f)
'''
rows = []
for stage in ['active-check', 'checkout', 'attest']:
    for label, source, fault in [('harmless comment first', base+b'\n# Harmless entry comment.\n', False),
                                  ('changed sealed input', base, True), ('restored source', base, False)]:
        spec = root/f'{len(rows)+1:02}-{stage}'; spec.mkdir(mode=0o700)
        for name in ['home','tmp','trap','fake-bin']:
            (spec/name).mkdir(mode=0o700)
        (spec/'branch').write_text(stage)
        (spec/'parent-net').write_text(os.readlink('/proc/self/ns/net'))
        (spec/'app_binding_v1.py').write_text(payload)
        (spec/'attest_start_v1.py').write_text(payload)
        trap = 'from pathlib import Path\nPath('+repr(str(spec/'interpreter-trap'))+').write_text("loaded")\n'
        (spec/'trap/sitecustomize.py').write_text(trap)
        # Per-unit injection avoids changing the user's manager environment.
        derived = source.replace(str(V2).encode(), str(spec).encode())
        derived = derived.replace(b'openplan-current-project-preview-app-678-v1-', f'openplan-review-r2-entry-{len(rows)+1:02}-'.encode())
        derived = derived.replace(b'-p UMask=0077', b'-p UMask=0077 --setenv=PYTHONPATH='+str(spec/'trap').encode()+b' --setenv=OPENAI_API_KEY=fixture-only --setenv=HTTP_PROXY=fixture-only --setenv=DOCKER_HOST=fixture-only')
        (spec/'stage.sh').write_bytes(derived)
        seal = ''.join(hashlib.sha256((spec/name).read_bytes()).hexdigest()+'  '+str(spec/name)+'\n'
                       for name in ['stage.sh','app_binding_v1.py','attest_start_v1.py'])
        (spec/'operation-files.sha256').write_text(seal)
        if fault:
            (spec/'app_binding_v1.py').write_text(payload+'\n# Unsealed comment.\n')
        for name in ['python3','sha256sum','systemd-run']:
            p = spec/'fake-bin'/name
            p.write_text('#!/bin/sh\nprintf trap > '+str(spec/'PATH-trap')+'\nexit 90\n'); p.chmod(0o700)
        env = {'PATH': str(spec/'fake-bin'), 'HOME': str(spec/'home'), 'PYTHONPATH': str(spec/'trap'),
               'ENV': str(spec/'shell-init'), 'BASH_ENV': str(spec/'shell-init'),
               'XDG_RUNTIME_DIR': '/run/user/'+str(os.getuid())}
        (spec/'shell-init').write_text('printf trap > '+str(spec/'shell-trap')+'\n')
        try:
            result = subprocess.run(['/bin/sh', str(spec/'stage.sh'), stage], env=env, capture_output=True, timeout=20)
            (spec/'runner-private.log').write_bytes(result.stdout+result.stderr)
            assert not (spec/'PATH-trap').exists() and not (spec/'shell-trap').exists()
            unit = f'openplan-review-r2-entry-{len(rows)+1:02}-{stage}.service'
            props = subprocess.check_output(['/usr/bin/systemctl','--user','show',unit,'--property=LoadState'],
                                            env={'PATH':'/usr/bin:/bin', 'XDG_RUNTIME_DIR':'/run/user/'+str(os.getuid())}, timeout=5).decode().strip()
            if fault:
                assert result.returncode != 0 and b'checksum' in result.stderr
                assert props == 'LoadState=not-found' and not (spec/'child.json').exists(), 'seal-reached-systemd'
                rows.append({'branch': stage, 'case': label, 'outcome': 'refused-before-systemd'})
            else:
                assert result.returncode == 0, result.stderr.decode()
                observed = json.loads((spec/'child.json').read_bytes())
                assert observed['branch'] == stage
                rows.append({'branch': stage, 'case': label, 'outcome': 'survived', 'observed': observed})
        finally:
            (spec/'app_binding_v1.py').write_text(payload)
            (spec/'stage.sh').write_bytes(derived)
            assert (spec/'app_binding_v1.py').read_text() == payload
assert (PUBLIC/'run_stage_v2.sh').read_bytes() == base
write(OUT/'entry-controls-01.json', {'cases': rows, 'restored': True,
      'limits': 'Owned payload replaces business code before dispatch. No checkout, active check, attestation, Docker, HTTP or database operation. Trusted /bin/sh and systemd user manager remain assumptions.'})
print(json.dumps({'observations': len(rows), 'branches': 3, 'restored': True}))
