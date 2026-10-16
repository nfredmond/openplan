"""Stream bytes/modes/link text without following borrowed dependency trees."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')
TARGETS={
    'frozen':Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015'),
    'app_packet':Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015'),
}

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def inventory(root):
    rows={}
    for folder,dirs,files in os.walk(root,followlinks=False):
        for name in sorted(dirs+files):
            p=Path(folder)/name;s=p.lstat();mode=stat.S_IMODE(s.st_mode)
            if p.is_symlink():value={'link':os.readlink(p),'mode':mode}
            elif p.is_file():value={'sha256':sha(p),'bytes':s.st_size,'mode':mode}
            elif p.is_dir():value={'directory':True,'mode':mode}
            else:raise AssertionError('unsupported-inventory-type')
            rows[str(p.relative_to(root))]=value
    return rows

def main():
    os.umask(0o077)
    if sys.argv[1]=='assay':
        root=ROOT/'inventory-specimen-01';root.mkdir(mode=0o700)
        file=root/'file';file.write_text('original');file.chmod(0o600)
        link=root/'link';link.symlink_to('file')
        baseline=inventory(root);rows=[]
        os.utime(file,None)
        assert inventory(root)==baseline
        rows.append({'case':'harmless mtime change','outcome':'survived'})
        try:
            file.write_text('modified');assert inventory(root)!=baseline
            rows.append({'case':'changed bytes','outcome':'detected'})
            file.write_text('original');file.chmod(0o644);assert inventory(root)!=baseline
            rows.append({'case':'changed mode','outcome':'detected'})
            file.chmod(0o600);link.unlink();link.symlink_to('foreign');assert inventory(root)!=baseline
            rows.append({'case':'changed symlink text','outcome':'detected'})
        finally:
            file.write_text('original');file.chmod(0o600);link.unlink();link.symlink_to('file')
        assert inventory(root)==baseline
        rows.append({'case':'finally restored','outcome':'survived'})
        with (ROOT/'preservation-assay-01.json').open('x') as f:json.dump(rows,f,indent=2)
        print(json.dumps({'observations':len(rows),'restored':True}))
        return
    rows={k:inventory(v) for k,v in TARGETS.items()}
    if sys.argv[1]=='before':
        with (ROOT/'preservation-before-private.json').open('x') as f:json.dump(rows,f)
    else:
        before=json.loads((ROOT/'preservation-before-private.json').read_bytes())
        assert rows==before, 'frozen-packet-changed'
        with (ROOT/'preservation-after-private.json').open('x') as f:json.dump(rows,f)
    print(json.dumps({k:{'entries':len(v),'filesAndLinks':sum('directory' not in x for x in v.values())} for k,v in rows.items()}))

if __name__=='__main__':main()
