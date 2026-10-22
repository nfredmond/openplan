"""Reproduce original metadata loss and restore actual owned HTTP proof subjects."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def run(repo, out, subnets):
    os.umask(0o077);out.mkdir(mode=0o700)
    source=repo/'workers/odm_worker/draft_http.py';original=source.read_bytes()
    runner=Path(__file__).with_name('native_engine.py');rows=[]
    text=original.decode();start=text.index("        boundary = 'openplan-'+uuid.uuid4().hex\n")
    end=text.index('        connection.putrequest',start)
    old='''        if command['path'] == '/task/new/init':
            prefix = urlencode(command['form']).encode();suffix = b''
            content_type = 'application/x-www-form-urlencoded'
        else:
            boundary = 'openplan-'+uuid.uuid4().hex
            prefix = (f'--{boundary}\\r\\nContent-Disposition: form-data; name="images"; filename="{command["multipart"]["filename"]}"\\r\\nContent-Type: application/octet-stream\\r\\n\\r\\n').encode()
            suffix = ('\\r\\n--'+boundary+'--\\r\\n').encode()
            content_type = 'multipart/form-data; boundary='+boundary
'''
    broken=(text[:start]+old+text[end:]).encode()
    try:
        for (label,payload,passing),subnet in zip((('harmless-comment',original+b'\n# Harmless native HTTP control.\n',True),('old-urlencoded-initialization',broken,False),('restored',original,True)),subnets,strict=True):
            try:
                source.write_bytes(payload);case=out/label
                result=subprocess.run([sys.executable,'-B',str(runner),'--out',str(case),'--subnet',subnet],cwd=repo,capture_output=True,timeout=90,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
                (out/(label+'.stdout')).write_bytes(result.stdout);(out/(label+'.stderr')).write_bytes(result.stderr)
                cleanup=json.loads((case/'cleanup-private.json').read_bytes())
                if not cleanup or any(row.get('running') is not False or row.get('exit')!=0 for row in cleanup):raise AssertionError('Native control did not stop its owned engines')
                if passing:
                    summary=json.loads((case/'summary.json').read_bytes())
                    if result.returncode or summary['allOwnedEnginesStopped'] is not True:raise AssertionError('Positive native HTTP control failed')
                    rows.append({'control':label,'outcome':'survived','summary':summary,'sourceSha256':hashlib.sha256(payload).hexdigest()})
                else:
                    captured=list((case/'engine-partial-private/tmp').glob('*/body.json'))
                    diagnostic=(case/'inspect-partial.stderr').read_text()
                    if result.returncode==0 or b'Native original draft inspection failed partial' not in result.stderr or diagnostic.strip()!='Captured draft metadata differs from original initialization' or len(captured)!=1 or json.loads(captured[0].read_bytes())!={}:raise AssertionError('Broken initialization did not reproduce exact captured metadata loss')
                    rows.append({'control':label,'outcome':'intended_failure','reason':diagnostic.strip(),'sourceSha256':hashlib.sha256(payload).hexdigest()})
            finally:source.write_bytes(original)
        if source.read_bytes()!=original:raise AssertionError('Native HTTP source was not restored')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source,runner,Path(__file__))},indent=2)+'\n')
        print(json.dumps({'controls':len(rows),'allPassed':True,'originalMetadataLossReproduced':True,'originalSourceRestored':True}),flush=True)
    finally:
        source.write_bytes(original)
        with source.open('rb') as f:os.fsync(f.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--subnets',nargs=3,required=True);args=parser.parse_args();run(args.repo.resolve(),args.out.absolute(),args.subnets)
