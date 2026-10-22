import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

def run(repo, out, config):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo / 'openplan/src/lib/aerial/artifact-custody-server.ts'
    original = source.read_bytes()
    (out / 'original-source-private.ts').write_bytes(original)
    rows = []
    def execute(label):
        target = out / label
        result = subprocess.run(['python3', '-B', str(Path(__file__).with_name('native_storage.py')),
            '--repo', str(repo), '--out', str(target), '--config', str(config)], cwd=repo,
            capture_output=True, text=True, timeout=100)
        (out / (label + '-private.log')).write_text(result.stdout + result.stderr)
        return result.returncode, target
    def positive(label):
        code, target = execute(label)
        assert code == 0, label + ' verifies actual immutable Storage and matching recovery'
        report = json.loads((target / 'native.json').read_text())
        assert report['matchingOriginalRecovered'] is True and report['originalSha256'] == report['afterSha256']
        rows.append({'case': label, 'outcome': 'survived', 'retainedDatabase': report['retainedDatabase']})
    try:
        positive('baseline')
        source.write_bytes(original + b'\n// Harmless native immutable Storage comment.\n')
        positive('harmless-comment')
        source.write_bytes(original)
        positive('restored-after-harmless')
        text = original.decode()
        for label, old, new, reason in [
            ('overwrite-restored', 'contentType: uploadContentType, upsert: false', 'contentType: uploadContentType, upsert: true', 'Error: Native retry replaces original stored bytes'),
            ('hash-ignored', 'hash.digest("hex") === expectedSha256', 'true', 'Error: Native different retry bytes become held'),
        ]:
            try:
                assert old in text
                source.write_text(text.replace(old, new, 1))
                code, target = execute(label)
                diagnostic = (target / 'native-private.log').read_text()
                assert code == 1 and reason in diagnostic, label + ' fails intended actual-object assertion'
                rows.append({'case': label, 'outcome': 'intended_failure', 'diagnostic': reason})
            finally:
                source.write_bytes(original)
        positive('restored')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'bindings.json').write_text(json.dumps({str(source.relative_to(repo)): hashlib.sha256(original).hexdigest()}, indent=2) + '\n')
        print(rows)
    finally:
        source.write_bytes(original)
        assert source.read_bytes() == original

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve(), args.config.resolve())
