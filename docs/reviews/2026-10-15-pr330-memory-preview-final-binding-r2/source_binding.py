"""Exact tracked source receipt. No checkout, compiler, database or service."""
import hashlib
import json
import os
from pathlib import Path


def require(value, reason):
    if not value:
        raise ValueError(reason)


def check(root, expected):
    require(root.is_dir() and not root.is_symlink(), 'source-root')
    observed={}
    for name, item in expected['files'].items():
        path=Path(name)
        require(not path.is_absolute() and '..' not in path.parts, 'source-relative-path')
        file=root/path
        mode=item['gitMode']
        if mode=='120000':
            require(file.is_symlink(), 'source-link-kind')
            data=os.readlink(file).encode()
            observed[name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'gitMode':mode}
        else:
            require(mode in {'100644','100755'} and file.is_file() and not file.is_symlink(), 'source-file-kind')
            h=hashlib.sha256()
            with file.open('rb') as stream:
                for block in iter(lambda:stream.read(1048576),b''):
                    h.update(block)
            actual_mode='100755' if file.stat().st_mode&0o111 else '100644'
            observed[name]={'sha256':h.hexdigest(),'bytes':file.stat().st_size,'gitMode':actual_mode}
    wanted={n:{k:v[k] for k in ['sha256','bytes','gitMode']} for n,v in expected['files'].items()}
    require(observed==wanted, 'source-file-bytes')
    return hashlib.sha256(json.dumps(observed,sort_keys=True,separators=(',',':')).encode()).hexdigest()
