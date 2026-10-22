"""Counterfactuals for capture predicates use an inert command boundary."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import capture


def scenario(module, base, kind):
    with tempfile.TemporaryDirectory(prefix='capture-', dir=base) as name:
        root = Path(name); package = root/'package'; (package/'bin').mkdir(parents=True)
        (package/'bin/codex').write_bytes(b'owned inert specimen')
        metadata = {'version':'0.154.0','target':'x86_64-unknown-linux-musl','entrypoint':'bin/codex'}
        if kind == 'metadata': metadata['version'] = '0.150.1'
        (package/'codex-package.json').write_text(json.dumps(metadata))
        module.PACKAGE = package
        def fake_command(target, label, arguments):
            if label == 'version':
                (target/'version-stdout.bin').write_text('codex-cli '+('0.150.1' if kind=='version' else '0.154.0')+'\n')
            if label == 'schema':
                output=target/'schemas';output.mkdir();file=output/'owned.json'
                file.write_text('{}')
                if kind=='empty': file.unlink()
                if kind=='kind': (output/'link').symlink_to(file)
                if kind=='bytes':
                    with file.open('wb') as stream: stream.truncate(64*1024**2+1)
                if kind=='package': (package/'bin/codex').write_bytes(b'changed specimen')
            return {'returncode':0}
        module.command = fake_command
        expected={'metadata':'cached-package-identity','version':'native-version-mismatch',
                  'kind':'schema-output-kind','bytes':'schema-output-byte-bound','package':'cached-package-changed','empty':'schema-output-empty'}.get(kind)
        try:
            with contextlib.redirect_stdout(io.StringIO()): module.main(root)
        except ValueError as error:
            assert str(error)==expected, 'wrong-refusal:'+kind
        else:
            assert expected is None, 'missing-refusal:'+kind


if __name__=='__main__':
    os.umask(0o077);base=Path(sys.argv[1]);source=Path(capture.__file__).read_text();rows=[]
    def load(text):
        module=type(sys)('owned_capture');exec(compile(text,'<owned-capture>','exec'),module.__dict__);return module
    for text,label in [(source,'baseline'),(source+'\n# harmless note\n','harmless')]:
        for case in ['good','metadata','version','kind','bytes','package','empty']:scenario(load(text),base,case)
        rows.append({'case':label,'checks':7})
    faults=[('metadata', "if metadata.get('version') != '0.154.0' or metadata.get('target') != 'x86_64-unknown-linux-musl' or metadata.get('entrypoint') != 'bin/codex':"),
            ('version', "if (root/'version-stdout.bin').read_text().strip() != 'codex-cli 0.154.0':"),
            ('kind', "if path.is_symlink() or not (path.is_file() or path.is_dir()):"),
            ('bytes', 'if total > 64*1024**2:'),('package','if before != after:'),('empty','if not inventory:')]
    for case,old in faults:
        assert source.count(old)==1
        changed=source.replace(old,'if False:')
        try:scenario(load(changed),base,case)
        except AssertionError as error:
            assert str(error)=='missing-refusal:'+case
            rows.append({'case':case,'namedFailure':str(error)})
        else:raise AssertionError('fault-survived:'+case)
        scenario(load(source),base,case)
    for case in ['good','metadata','version','kind','bytes','package','empty']:scenario(load(source),base,case)
    path=base/'capture-controls.json'
    with path.open('x') as stream:json.dump({'rows':rows,'restored':True,'nativeCommands':False},stream,indent=2)
    print(json.dumps({'baseline':7,'harmless':7,'namedFaults':6,'restored':7,'nativeCommands':False}))
