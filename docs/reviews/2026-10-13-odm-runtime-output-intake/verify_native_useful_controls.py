"""Require useful-output RPC controls to fail at their named assertion."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code,text,reason):
    return code==1 and re.findall(r'^([A-Za-z_][\w.]*Error:.*)$',text,re.MULTILINE)==['AssertionError: '+reason]


def run(repo,fixture,useful,producer,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    observer=repo/'workers/odm_worker/runtime_observation.py';intake=repo/'workers/odm_worker/runtime_output_intake.py'
    originals={p:p.read_bytes() for p in [observer,intake,producer]};rows=[]
    reason='Native saved output must preserve exact useful archive custody'
    diagnostic='Traceback (most recent call last):\nAssertionError: '+reason+'\n'
    oracle=[]
    for label,text in [('baseline',diagnostic),('harmless',diagnostic+'# Harmless diagnostic.\n'),('restored',diagnostic)]:
        assert intended(1,text,reason);oracle.append({'control':label,'outcome':'survived'})
    for label,code,text in [('wrong-exit',0,diagnostic),('wrong-reason',1,diagnostic.replace(reason,'Unrelated failure')),('wrong-kind',1,diagnostic.replace('AssertionError','ValueError')),('extra-error',1,diagnostic+'ValueError: Extra failure\n'),('missing-error',1,'')]:
        assert not intended(code,text,reason), 'Native output oracle accepted an unrelated failure'
        oracle.append({'control':label,'outcome':'intended_refusal'})
    (out/'oracle-controls.json').write_text(json.dumps(oracle,indent=2)+'\n')
    def restore():
        for path,data in originals.items():path.write_bytes(data)
    def phase(label,expected=None):
        cmd=[sys.executable,'-B',str(producer),'--repo',str(repo),'--fixture',str(fixture),'--useful',str(useful),'--out',str(out/(label+'-private'))]
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=300,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        text=result.stdout+result.stderr;(out/(label+'-private.log')).write_text(text)
        if expected:
            assert intended(result.returncode,text,expected), 'Wrong native useful-output failure: '+label
            row={'control':label,'outcome':'intended_failure','reason':expected}
        else:
            assert result.returncode==0 and (out/(label+'-private/results.json')).exists(), 'Native useful-output positive failed: '+label
            data=json.loads((out/(label+'-private/results.json')).read_bytes());assert len(data['cases'])==5
            row={'control':label,'outcome':'survived','cases':5}
        rows.append(row);(out/'partial-controls.json').write_text(json.dumps(rows,indent=2)+'\n');print(label+': '+row['outcome'],flush=True)
    try:
        phase('baseline');intake.write_bytes(originals[intake]+b'\n# Harmless native output-custody comment.\n');phase('harmless');restore();phase('restored')
        old=b"        if observed['authorizedNow'] is not True:";assert originals[observer].count(old)==1
        observer.write_bytes(originals[observer].replace(old,b'        if False:'));phase('revoked-actor-ignored','Native output must refuse a revoked original actor');restore()
        old=b"            raise ValueError('Original output stored byte count differs')\n        self._access(request_id, deadline)";assert originals[intake].count(old)==1
        intake.write_bytes(originals[intake].replace(old,old.replace(b'self._access',b'self._check')));phase('download-current-read-lost','Native output download must use five current permissions, one archive GET and two engine checks');restore()
        old=b"            receipt = self._receipt(pack, plan_hash)";assert originals[intake].count(old)==1
        added=b'''
            if receipt is not None:
                import io
                transport = Transport(plan, self.observer.resolve,
                    lambda engine, end: self.observer.attest(engine, end, owned=lambda: self.observer.reader.dispatch.runtime._owned),
                    cancelled=self.cancelled)
                transport(plan, io.BytesIO(), self.limits['max_archive_bytes'], deadline,
                    owned=lambda: self.observer.reader.dispatch.runtime._owned)'''
        intake.write_bytes(originals[intake].replace(old,old+added));phase('saved-replay-refetches','Native saved output must check three current permissions without another archive GET');restore()
        old=b"            actual=digest(archive_root,'archive.zip',256*1024**2,time.monotonic()+120)";assert originals[producer].count(old)==1
        added=b"            with (archive_root/'archive.zip').open('ab') as stream:stream.write(b'corrupt native fixture bytes')\n"
        producer.write_bytes(originals[producer].replace(old,added+old));phase('native-archive-corrupted','Native retained output file must match independent useful archive bytes');restore()
        old=b"            raise ValueError('Original output stored byte count differs')\n        self._access(request_id, deadline)";assert originals[intake].count(old)==1
        new=b"            raise ValueError('Original output stored byte count differs')\n        try:self._access(request_id, deadline)\n        except PermissionError:pass"
        intake.write_bytes(originals[intake].replace(old,new));phase('post-download-revocation-swallowed','Native post-download revocation cannot confirm bytes or archive custody');restore()
        old=b"                receipt = self._download(pack, plan, plan_hash, request_id, remaining, deadline)";assert originals[intake].count(old)==1
        new=b"                for old_attempt in objects.glob('*.bin'):old_attempt.unlink()\n"+old
        intake.write_bytes(originals[intake].replace(old,new));phase('unconfirmed-attempt-removed','Native recovery must retain both bounded attempts and preserve useful bytes');restore()
        old=b"            final = self._access(request_id, deadline)";assert originals[intake].count(old)==1
        new=b"            archive['archiveTaskProvenanceVerification'] = 'verified'\n"+old
        intake.write_bytes(originals[intake].replace(old,new));phase('archive-provenance-promoted','Native saved output must preserve exact useful archive custody');restore()
        old=b"                'callbackPermission': False, 'publicationPermission': False}";assert originals[intake].count(old)==1
        intake.write_bytes(originals[intake].replace(old,old.replace(b"'publicationPermission': False",b"'publicationPermission': True")));phase('publication-promoted','Native output cannot promote callback, publication or quality');restore()
        phase('restored-final')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        bindings={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (repo/'workers/odm_worker').glob('*.py')}
        bindings['nativeProducerSha256']=hashlib.sha256(producer.read_bytes()).hexdigest();bindings['nativeControllerSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        (out/'source-bindings.json').write_text(json.dumps(bindings,indent=2)+'\n')
        group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({k:(group/k).read_text().strip() for k in ['memory.max','memory.peak','memory.swap.max','memory.swap.peak','memory.events']},indent=2)+'\n')
    finally:
        restore()
        for p,data in originals.items():
            with p.open('rb') as stream:os.fsync(stream.fileno())
            assert p.read_bytes()==data


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['repo','fixture','useful','producer','out']:parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();run(*(getattr(args,n).resolve() for n in ['repo','fixture','useful','producer','out']))
