"""Real kernel controls use owned specimens, never shared dependency files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import isolation


def run(args, code):
    return subprocess.run(args + ['/usr/bin/python3', '-B', '-c', code],
                          capture_output=True, timeout=10)


def campaign(root):
    rows = []
    with tempfile.TemporaryDirectory(prefix='kernel-', dir=root) as name:
        base = Path(name); checkout = base/'checkout'; private = base/'private'
        donor = checkout/'node_modules'; package = base/'package'
        for path in (checkout, private, donor, package): path.mkdir(mode=0o700)
        target = donor/'results.json'; target.write_bytes(b'original\n')
        outside = base/'outside'; outside.write_bytes(b'outside\n')
        original = target.read_bytes(); outside_bytes = outside.read_bytes()
        code = f"import errno,pathlib; p=pathlib.Path({str(target)!r}); assert p.read_bytes()==b'original\\n';\ntry: p.write_bytes(b'changed\\n')\nexcept OSError as e: assert e.errno==errno.EROFS\nelse: raise AssertionError('donor-write-reached')"
        try:
            commands = isolation.scoped(checkout, private, donor)
            baseline = run(commands, code)
            assert baseline.returncode == 0, baseline.stderr.decode()
            rows.append({'case':'donor-read-and-write-refusal','returncode':0})
            harmless = run(commands, '# harmless comment\n' + code)
            assert harmless.returncode == 0, harmless.stderr.decode()
            rows.append({'case':'harmless-comment','returncode':0})
            fault = run(commands + ['--bind', str(donor), str(donor)], code)
            assert fault.returncode != 0 and b'donor-write-reached' in fault.stderr
            assert target.read_bytes() == b'changed\n'
            rows.append({'case':'writable-donor-override','namedFailure':'donor-write-reached'})
        finally:
            target.write_bytes(original); outside.write_bytes(outside_bytes)
        assert target.read_bytes() == original
        assert run(isolation.scoped(checkout, private, donor), code).returncode == 0
        rows.append({'case':'restored-donor','sha256':hashlib.sha256(original).hexdigest()})
        host_ns = os.readlink('/proc/self/ns/net')
        net_code = f"import os; assert os.readlink('/proc/self/ns/net') != {host_ns!r}, 'host-network-visible'; assert not os.path.exists('/home/nathaniel/.codex'), 'host-profile-visible'"
        commands = isolation.offline(package, private)
        baseline = run(commands, net_code)
        assert baseline.returncode == 0, baseline.stderr.decode()
        rows.append({'case':'offline-network-and-profile-boundary','returncode':0})
        fault = run([x for x in commands if x != '--unshare-all'], net_code)
        assert fault.returncode != 0 and b'host-network-visible' in fault.stderr
        rows.append({'case':'omit-network-namespace','namedFailure':'host-network-visible'})
        # Expose an owned empty specimen at the excluded profile path. No real
        # host profile is mounted or read to exercise this assertion.
        fault = run(commands + ['--dir', '/home', '--dir', '/home/nathaniel',
                                '--ro-bind', str(package), '/home/nathaniel/.codex'], net_code)
        assert fault.returncode != 0 and b'host-profile-visible' in fault.stderr
        rows.append({'case':'expose-owned-profile-specimen','namedFailure':'host-profile-visible'})
        assert run(commands, '# harmless\n'+net_code).returncode == 0
        rows.append({'case':'offline-harmless-and-restored','returncode':0})
    return rows


if __name__ == '__main__':
    os.umask(0o077)
    root = Path(sys.argv[1])
    rows = campaign(root)
    result = root/'isolation-controls.json'
    with result.open('x') as stream:
        json.dump({'rows':rows,'sharedDonorTouched':False,
                   'blind':'Owned kernel specimens, not native provider or Vitest acceptance.'},stream,indent=2)
        stream.write('\n')
    print(json.dumps({'cases':len(rows),'namedFaults':3,'harmlessSurvivors':2,'restoration':True}))
