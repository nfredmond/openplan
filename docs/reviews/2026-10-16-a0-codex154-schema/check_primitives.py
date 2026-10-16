"""Path and exclusive-record controls use owned inert specimens."""
import json
import os
from pathlib import Path
import sys
import tempfile
import capture
import isolation


def load(source):
    module = type(sys)('owned_subject')
    exec(compile(source, '<owned-subject>', 'exec'), module.__dict__)
    return module


def refuses(operation, label):
    try: operation()
    except (ValueError, FileExistsError): return
    raise AssertionError('missing-refusal:' + label)


def campaign(base):
    source = Path(isolation.__file__).read_text()
    recorder = Path(capture.__file__).read_text()
    rows = []
    with tempfile.TemporaryDirectory(prefix='primitives-', dir=base) as name:
        root = Path(name); good = root/'good'; good.mkdir(); link = root/'link'
        link.symlink_to(good); absent = root/'absent'; private = root/'private'; private.mkdir()
        cases = [('relative', Path('.')), ('symlink', link), ('missing', absent)]
        guard = "if not path.is_absolute() or path.resolve() != path or not path.is_dir():"
        for text, label in [(source, 'baseline'), (source+'\n# harmless\n', 'harmless')]:
            module = load(text)
            assert module.directory(good) == str(good)
            for kind, path in cases: refuses(lambda: module.directory(path), kind)
            refuses(lambda: module.scoped(good, private, good), 'donor-checkout')
            refuses(lambda: module.scoped(good, private, private), 'donor-private')
            rows.append({'case':label, 'refusals':5})
        assert source.count(guard)==1
        broken = load(source.replace(guard, 'if False:'))
        for kind, path in cases:
            try: refuses(lambda: broken.directory(path), kind)
            except AssertionError as error:
                assert str(error)=='missing-refusal:'+kind
                rows.append({'case':kind,'namedFailure':str(error)})
            else: raise AssertionError('fault-survived:'+kind)
            refuses(lambda: load(source).directory(path), kind)
        guard = 'if checkout == donor or private == donor:'
        assert source.count(guard)==1
        broken = load(source.replace(guard, 'if False:'))
        for kind, donor in [('donor-checkout',good),('donor-private',private)]:
            try: refuses(lambda: broken.scoped(good, private, donor), kind)
            except AssertionError as error:
                assert str(error)=='missing-refusal:'+kind
                rows.append({'case':kind,'namedFailure':str(error)})
            else: raise AssertionError('fault-survived:'+kind)
            refuses(lambda: load(source).scoped(good, private, donor), kind)
        target = root/'record.json'
        for text,label in [(recorder,'record-baseline'),(recorder+'\n# harmless\n','record-harmless')]:
            target.write_bytes(b'original\n')
            refuses(lambda: load(text).record(target, {'changed':True}), label)
            assert target.read_bytes()==b'original\n'
            rows.append({'case':label,'preserved':True})
        guard = "with path.open('x') as stream:"
        assert recorder.count(guard)==1
        try:
            try: refuses(lambda: load(recorder.replace(guard,"with path.open('w') as stream:")).record(target,{'changed':True}), 'exclusive-record')
            except AssertionError as error:
                assert str(error)=='missing-refusal:exclusive-record'
                rows.append({'case':'exclusive-record','namedFailure':str(error)})
            else: raise AssertionError('fault-survived:exclusive-record')
        finally: target.write_bytes(b'original\n')
        refuses(lambda: load(recorder).record(target,{}), 'restored-record')
        assert target.read_bytes()==b'original\n'
    return rows


if __name__=='__main__':
    os.umask(0o077);base=Path(sys.argv[1]);rows=campaign(base)
    with (base/'primitive-controls.json').open('x') as stream:
        json.dump({'rows':rows,'restored':True,'nativeCommands':False},stream,indent=2)
    print(json.dumps({'rows':len(rows),'namedFaults':6,'restored':True}))
