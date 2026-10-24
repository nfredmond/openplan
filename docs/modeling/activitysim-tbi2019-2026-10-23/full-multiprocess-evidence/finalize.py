"""Retain private output custody and recheck frozen and installed source bytes."""
import hashlib
import json
from pathlib import Path

E=Path(__file__).resolve().parent
REPO=E.parents[3]
R=Path('/home/nathaniel/.local/state/openplan/tbi2019-full-multiprocess-20261024')
FROZEN=Path('/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024/frozen-preservation.json')
ARCHIVE=Path('/home/nathaniel/.local/state/openplan/tbi2019-evidence-archive-20261024')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def main():
    engine=json.loads((E.parent/'multiprocess-evidence/engine-preservation.json').read_text())['files']
    engine_result={'files_checked':len(engine),'all_hashes_unchanged':all(digest(Path(p))==h for p,h in engine.items()),'files':engine}
    (E/'engine-preservation.json').write_text(json.dumps(engine_result,indent=2)+'\n')
    frozen=json.loads(FROZEN.read_text())['files']
    rows=[]
    for row in frozen:
        path=REPO/row['path']; path=path if path.exists() else ARCHIVE/row['path']
        rows.append({'path':row['path'],'unchanged':digest(path)==row['sha256']})
    frozen_result={'files_checked':len(rows),'all_hashes_unchanged':all(x['unchanged'] for x in rows),'method':'Opaque SHA-256 only; no outcome parsing'}
    (E/'frozen-preservation.json').write_text(json.dumps(frozen_result,indent=2)+'\n')
    assert engine_result['all_hashes_unchanged'] and frozen_result['all_hashes_unchanged']
    files=[{'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(R.rglob('*')) if p.is_file() and p.name!='OUTPUT_MANIFEST.json']
    manifest=R/'OUTPUT_MANIFEST.json'
    manifest.write_text(json.dumps({'root':str(R),'files':files,'outcomes_accessed':False},indent=2)+'\n')
    mismatches=[row['path'] for row in files if (R/row['path']).stat().st_size!=row['bytes'] or digest(R/row['path'])!=row['sha256']]
    custody={'root':str(R),'manifest_path':str(manifest),'manifest_sha256':digest(manifest),'files':len(files),'bytes':sum(x['bytes'] for x in files),'all_entries_reverified':not mismatches,'mismatches':mismatches,'outputs_in_git':False,'outcomes_accessed':False}
    (E/'OUTPUT_CUSTODY.json').write_text(json.dumps(custody,indent=2)+'\n')
    assert not mismatches
    print(json.dumps(custody,indent=2))


if __name__=='__main__': main()
