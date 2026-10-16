"""Tiny private review specimens. No application, database, or real tmpfs root."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types

COMMIT = '97c310944ecf694525798bcc7cdb30edb7832686'
PREFIX = 'docs/reviews/2026-10-15-pr330-memory-preview-preparation/'
BASE = Path('/home/nathaniel/.local/state/openplan/pr330-memory-storage-independent-review-20261015')
PRIVATE = BASE/'trial-03'
REPO = Path(__file__).resolve().parents[3]
VIRTUAL = Path('/dev/shm/openplan-pr330-preview-20261015')


def blob(name):
    return subprocess.check_output(['git', '-C', str(REPO), 'show', COMMIT+':'+PREFIX+name])


def module(source):
    value = types.ModuleType('review_specimen')
    exec(compile(source, 'review-specimen.py', 'exec'), value.__dict__)
    return value


def resources():
    relative = Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
    root = Path('/sys/fs/cgroup')/relative
    return {name:(root/name).read_text().strip() for name in
            ['memory.max', 'memory.swap.max', 'memory.swap.current', 'cpu.max', 'memory.events', 'memory.peak']}


def link_trial(source, name):
    m = module(source)
    root = PRIVATE/name
    root.mkdir(mode=0o700)
    work = root/'work'
    (work/'candidate/.agents').mkdir(parents=True, mode=0o700)
    (work/'candidate/.claude/skills').mkdir(parents=True, mode=0o700)
    (work/'candidate/openplan').mkdir(mode=0o700)
    (work/'candidate/openplan/source.txt').write_text('private stand-in\n')
    link = work/'candidate/.agents/skills'
    link.symlink_to('../.claude/skills')
    dest = root/'archive'
    dest.mkdir(mode=0o700)
    try:
        manifest = m.capture(work, dest, {'head':m.HEAD, 'appTree':m.TREE}, 'successful')
        m.verify_archive(dest/'build.tar.gz', manifest)
        accepted = manifest['entries']['candidate/.agents/skills']
    except ValueError as error:
        return {'result':'refused', 'reason':str(error)}
    link.unlink()
    link.symlink_to('/etc/passwd')
    try:
        m.inventory(work)
    except ValueError as error:
        assert str(error) == 'archive-link'
    else:
        raise AssertionError('unowned link accepted by review correction')
    return {'result':'archived-and-read-back', 'trackedLink':accepted, 'unownedLink':'archive-link refusal'}


def namespace_trial(source, name, readonly=False):
    m = module(source)
    fixture = PRIVATE/name
    fixture.mkdir(mode=0o700)
    for child in ['candidate/openplan', 'execution/tmp', 'donor']:
        (fixture/child).mkdir(parents=True, mode=0o700)
    (fixture/'memory_storage.py').write_text('original controller\n')
    (fixture/'candidate/openplan/.env.local').write_text('STAND_IN=true\n')
    m.ROOT = VIRTUAL
    m.CANDIDATE = VIRTUAL/'candidate'
    m.APP = m.CANDIDATE/'openplan'
    m.RUN = VIRTUAL/'execution'
    m.DEPS = fixture/'donor'
    args = m.confined_argv('build')
    args = args[:args.index('/usr/bin/npm')]
    # Translate only bind sources into owned disk-backed specimens.
    for i, arg in enumerate(args):
        if arg in {'--bind', '--ro-bind'} and args[i+1].startswith(str(VIRTUAL)):
            relative = Path(args[i+1]).relative_to(VIRTUAL)
            args[i+1] = str(fixture/relative)
            if readonly and relative == Path('.'):
                args[i] = '--ro-bind'
    program = """import errno,json
from pathlib import Path
root=Path('/dev/shm/openplan-pr330-preview-20261015')
result={}
for label,path in [('controller',root/'memory_storage.py'),('candidate',root/'candidate/openplan/owned.txt'),('execution',root/'execution/owned.txt')]:
    try:
        path.write_text('private probe write\\n')
        result[label]='writable'
    except OSError as error:
        result[label]=errno.errorcode[error.errno]
print(json.dumps(result))
"""
    run = subprocess.run(args+['/usr/bin/python3', '-B', '-c', program],
                         env={'PATH':'/usr/bin:/bin', 'HOME':str(PRIVATE/'home'),
                              'PYTHONDONTWRITEBYTECODE':'1'}, capture_output=True, timeout=15)
    (fixture/'stdout').write_bytes(run.stdout)
    (fixture/'stderr').write_bytes(run.stderr)
    assert run.returncode == 0, 'namespace specimen failed; inspect private stderr'
    value = json.loads(run.stdout)
    assert value == {'controller':'EROFS' if readonly else 'writable',
                     'candidate':'writable', 'execution':'writable'}
    return value


def main():
    os.umask(0o077)
    assert len(sys.argv) == 1
    PRIVATE.mkdir(mode=0o700)
    before = resources()
    assert before['memory.max'] == str(512*1024**2)
    assert before['memory.swap.max'] == before['memory.swap.current'] == '0'
    quota, period = map(int, before['cpu.max'].split())
    assert 0 < quota <= period//2
    assert not VIRTUAL.exists()
    storage = blob('memory_storage.py')
    app = blob('templates/app_binding_v1.py')
    anchor = "require(name=='candidate/openplan/node_modules' and os.readlink(path)==DEPS, 'archive-link')"
    correction = "require((name=='candidate/openplan/node_modules' and os.readlink(path)==DEPS) or (name=='candidate/.agents/skills' and os.readlink(path)=='../.claude/skills'), 'archive-link')"
    assert storage.decode().count(anchor) == 1
    links = {
        'candidate':link_trial(storage, 'link-candidate'),
        'harmlessComment':link_trial(storage+b'\n# harmless review comment\n', 'link-harmless'),
        'privateCorrection':link_trial(storage.decode().replace(anchor, correction).encode(), 'link-correction'),
    }
    assert links['candidate'] == links['harmlessComment'] == {'result':'refused', 'reason':'archive-link'}
    assert links['privateCorrection']['result'] == 'archived-and-read-back'
    namespace = {
        'candidate':namespace_trial(app, 'namespace-candidate'),
        'harmlessComment':namespace_trial(app+b'\n# harmless review comment\n', 'namespace-harmless'),
        'privateReadonlyCorrection':namespace_trial(app, 'namespace-readonly', readonly=True),
    }
    assert not VIRTUAL.exists()
    after = resources()
    assert after['memory.swap.current'] == '0'
    events = dict(line.split() for line in after['memory.events'].splitlines())
    assert all(events[key] == '0' for key in ['max','oom','oom_kill'])
    result = {'candidateCommit':COMMIT, 'storageSHA256':hashlib.sha256(storage).hexdigest(),
              'appSHA256':hashlib.sha256(app).hexdigest(), 'trackedSymlink':links,
              'namespaceRootWrites':namespace, 'resourcesBefore':before, 'resourcesAfter':after,
              'sourceUntouched':storage == blob('memory_storage.py') and app == blob('templates/app_binding_v1.py'),
              'realMemoryRootAbsent':not VIRTUAL.exists(),
              'blindCategories':['disk-backed tiny specimens mapped into private namespaces',
                                 'no actual tmpfs allocation, cgroup page-attribution measurement or native addon',
                                 'no application/DB/helper/build/start/browser/recovery acceptance']}
    path = PRIVATE/'probe-result.json'
    with path.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'result':'observed', 'sourceUntouched':result['sourceUntouched'],
                      'realMemoryRootAbsent':result['realMemoryRootAbsent'], 'peak':after['memory.peak']}))


if __name__ == '__main__':
    main()
