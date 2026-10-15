"""Trusted outer checker gets only journal/receipt disk writes, not disk seals."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import uuid

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')


def probe(fault=None):
    fixture=PRIVATE/'fixtures'/('outer-'+uuid.uuid4().hex);fixture.mkdir(mode=0o700)
    work=fixture/'working';work.mkdir(mode=0o700);(work/'tmp').mkdir(mode=0o700)
    disk=fixture/'durable';disk.mkdir(mode=0o700)
    for n in ['journal','receipts']:(disk/n).mkdir(mode=0o700)
    (disk/'seal.json').write_text('original fixture seal\n')
    text=(HERE/'templates/run_stage.sh').read_text();start=text.index('    /usr/bin/bwrap')
    end=text.index('    /usr/bin/env',start)
    words=shlex.split(text[start:end].replace('\\\n',''))
    virtual='/dev/shm/openplan-pr330-preview-20261015'
    words=[s.replace('$ROOT',virtual).replace('$DURABLE',str(disk)) for s in words]
    i=0
    while i<len(words):
        if words[i] in {'--bind','--ro-bind'}:
            if words[i+1].startswith(virtual):words[i+1]=str(work)+words[i+1][len(virtual):]
            i+=3
        else:i+=1
    if fault=='missing-journal':
        index=next(i for i,x in enumerate(words) if x=='--bind' and words[i+1]==str(disk/'journal'))
        del words[index:index+3]
    if fault=='whole-disk-root':words+=['--bind',str(disk),str(disk)]
    program="""import os,json
from pathlib import Path
d=Path(DISK);out={}
for name in ['journal/a','receipts/a']:
 try:(d/name).write_text('owned');out[name]='written'
 except OSError as e:out[name]=e.errno
try:
 fd=os.open(d/'seal.json',os.O_WRONLY);os.close(fd);out['seal']='writable'
except OSError as e:out['seal']=e.errno
print(json.dumps(out))
""".replace('DISK',repr(str(disk)))
    result=subprocess.run(words+['/usr/bin/python3','-B','-c',program],env={'PATH':'/usr/bin:/bin'},capture_output=True,timeout=10)
    assert result.returncode==0,'outer probe failed to run'
    observed=json.loads(result.stdout)
    assert observed['journal/a']=='written' and observed['receipts/a']=='written','durable outer writes must succeed'
    assert observed['seal']==30,'durable outer seal must refuse EROFS'


def main():
    os.umask(0o077);probe()
    for fault,diagnostic in [('missing-journal','durable outer writes must succeed'),('whole-disk-root','durable outer seal must refuse EROFS')]:
        try:probe(fault)
        except AssertionError as e:assert str(e)==diagnostic
        else:raise AssertionError('outer fault survived')
    record={'preparedOnly':True,'healthy':'journal/receipt writes succeed; durable seal write EROFS',
        'faults':['missing journal bind refuses needed write','whole durable-root bind exposes seal and is detected'],
        'sourceUnchanged':True,'boundary':'Tiny namespace stand-ins only. No real controller stage or DB/helper/app.'}
    (PRIVATE/'records/outer-journal-control.json').write_text(json.dumps(record,indent=2)+'\n')
    (HERE/'outer-journal-control.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'outerJournal':'pass','targetedFaults':2}))


if __name__=='__main__':main()
