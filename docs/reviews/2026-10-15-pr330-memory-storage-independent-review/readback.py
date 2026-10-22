"""Read retained preparation receipts without operating their controllers."""
import ast
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
COMMIT = '97c310944ecf694525798bcc7cdb30edb7832686'
PREFIX = 'docs/reviews/2026-10-15-pr330-memory-preview-preparation/'
PRIVATE = Path('/home/nathaniel/.local/state/openplan/pr330-memory-storage-independent-review-20261015')
DRAFT = Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015')
V6 = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def blob(name):
    return subprocess.check_output(['git', '-C', str(REPO), 'show', COMMIT+':'+PREFIX+name])


def main():
    os.umask(0o077)
    paths = subprocess.check_output(['git', '-C', str(REPO), 'ls-tree', '-r', '--name-only', COMMIT, PREFIX]).decode().splitlines()
    pins = {path[len(PREFIX):]:hashlib.sha256(blob(path[len(PREFIX):])).hexdigest() for path in paths}
    checks = {}
    for line in blob('PREPARATION_FILES.sha256').decode().splitlines():
        expected, name = line.split('  ', 1)
        checks[name] = pins[name] == expected
    assert len(checks) == 29 and all(checks.values())
    retained = {}
    for public, private in [('controls.json','records/controls-7408e1f11f77411a91a76c40bee20089.json'),
                            ('context.json','records/context.json'), ('identity.json','records/identity.json'),
                            ('preparation-audit.json','records/preparation-audit.json')]:
        retained[public] = json.loads(blob(public)) == json.loads((DRAFT/private).read_bytes())
    assert all(retained.values())
    controls = json.loads(blob('controls.json'))
    assert controls['sourceSHA256'] == pins['memory_storage.py']
    assert sha(DRAFT/'fixtures/memory-specimen.py') == pins['memory_storage.py']
    changes = {}
    for name in ['app_binding_v1.py','attest_start_v1.py','helper.py','observer.py','observer_transport.py','policy.py']:
        old = (V6/name).read_text()
        new = blob('templates/'+name).decode()
        def functions(text):
            lines = text.splitlines(keepends=True)
            return {n.name:''.join(lines[n.lineno-1:n.end_lineno]) for n in ast.parse(text).body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        a, b = functions(old), functions(new)
        changes[name] = {'unchangedFunctions':sorted(k for k in a.keys() & b.keys() if a[k] == b[k]),
                         'changedFunctions':sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))}
        diff = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                       fromfile='retained-v6/'+name, tofile='memory/'+name, n=0))
        assert diff == blob(name+'.patch').decode()
    custody = json.loads((DRAFT/'preparation-custody-final.json').read_bytes())
    archive = DRAFT/'preparation-evidence-final.tar.gz'
    assert sha(archive) == custody['archiveSHA256']
    assert archive.stat().st_size == custody['archiveBytes']
    members = 0
    file_count = 0
    with tarfile.open(archive, 'r|gz') as stream:
        for member in stream:
            members += 1
            name = PurePosixPath(member.name)
            category, *rest = name.parts
            relative = Path(*rest)
            if member.isfile():
                file_count += 1
                observed = hashlib.file_digest(stream.extractfile(member), 'sha256').hexdigest()
                if category == 'public':
                    expected = pins[str(relative)]
                else:
                    base = {'private-templates':'templates','private-records':'records','private-fixtures':'fixtures'}[category]
                    expected = sha(DRAFT/base/relative)
                assert observed == expected, 'retained archive member differs'
    assert members == custody['members'] == 2972
    before = DRAFT/'records/v6-inventory-before.json'
    after = DRAFT/'records/v6-inventory-after.json'
    assert before.read_bytes() == after.read_bytes()
    result = {'candidateCommit':COMMIT, 'sourcePins':pins, 'preparationListPinsMatched':len(checks),
              'retainedPublicPrivateReceiptEquality':retained, 'functionComparison':changes,
              'controlCount':len(controls['controls']), 'controlSpecimenRestored':True,
              'preparationArchive':{'sha256':custody['archiveSHA256'], 'members':members,
                                    'fileBytesCompared':file_count, 'applicationArchive':False},
              'retainedV6BeforeAfterEqual':True, 'retainedV6Entries':len(json.loads(before.read_bytes())),
              'blindCategories':['retained receipt readback, not a fresh V6/runtime/DB census',
                                 'archive hash/content readback, not extraction/recovery/installation',
                                 'unchanged function bytes do not establish preserved operating context']}
    with (PRIVATE/'readback-result.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'pins':len(pins), 'archiveMembers':members, 'archiveFiles':file_count,
                      'controls':len(controls['controls'])}))


if __name__ == '__main__':
    main()
