"""Challenge reply-framing tests against actual local HTTP and restore sources."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def intended(code, output, names, kind, diagnostic):
    marker='FAIL' if kind=='failures' else 'ERROR'
    return code==1 and f'FAILED ({kind}={len(names)})' in output and diagnostic in output and all(
        f'{marker}: {name} (test_draft_http.Checks.{name})' in output for name in names)


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    module=repo/'workers/odm_worker/draft_http.py';tests=repo/'workers/odm_worker/test_draft_http.py'
    original=module.read_bytes();test_original=tests.read_bytes();text=original.decode();test_text=test_original.decode()
    guard="        if response.length not in (None, 0):\n            raise ValueError('Original HTTP response is incomplete')\n"
    if text.count(guard)!=1:raise ValueError('Reply framing guard must be unique')
    short=['test_incomplete_content_length_refuses_valid_json_prefix','test_incomplete_content_length_refuses_empty_prefix']
    cases=[('omitted-framing-guard',text.replace(guard,''),test_text,short,'failures','AssertionError: RuntimeError not raised'),
        ('admitted-unread-bytes',text.replace('(None, 0):','(None, 0, 17):'),test_text,short,'failures','AssertionError: RuntimeError not raised'),
        ('valid-close-delimiter-refused',text.replace('(None, 0):','(0,):'),test_text,
            ['test_complete_close_delimited_reply_preserves_exact_bytes'],'errors','RuntimeError: Original draft HTTP child failed'),
        ('valid-empty-frame-refused',text.replace(guard,"        if not body:\n            raise ValueError('Empty HTTP body refused')\n"+guard),test_text,
            ['test_complete_zero_length_reply_is_not_a_framing_error'],'errors','RuntimeError: Original draft HTTP child failed')]
    declared="len(response)+(17 if fixture.mode=='short_reply' else 0)"
    if test_text.count(declared)!=1:raise ValueError('Actual short-reply fixture must be unique')
    cases.append(('short-frame-fixture-lost',text,test_text.replace(declared,'len(response)'),short,'failures','AssertionError: RuntimeError not raised'))
    observed="                fixture.requests.append({'path': self.path, 'headers': dict(self.headers), 'body': body})"
    if test_text.count(observed)!=1:raise ValueError('Actual request observer must be unique')
    cases.append(('request-observation-lost',text,test_text.replace(observed,'                pass'),short,'failures','0 != 1'))
    outcomes=[];oracles=[]
    def execute(label,names=None):
        selected=['test_draft_http.Checks.'+name for name in names] if names else ['test_draft_http']
        result=subprocess.run([sys.executable,'-B','-m','unittest','-v',*selected],cwd=module.parent,
            capture_output=True,text=True,timeout=60,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=result.stdout+result.stderr;(out/(label+'-private.log')).write_text(output)
        return result.returncode,output
    def positive(label,payload):
        module.write_bytes(payload);tests.write_bytes(test_original)
        code,output=execute(label)
        if code or 'Ran 35 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label+' full HTTP cohort failed')
        outcomes.append({'control':label,'outcome':'survived','cases':35})
    try:
        positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless reply-framing control.\n');positive('restored-after-harmless',original)
        for label,changed,changed_tests,names,kind,diagnostic in cases:
            try:
                ast.parse(changed);ast.parse(changed_tests);module.write_text(changed);tests.write_text(changed_tests)
                code,output=execute(label,names)
                if not intended(code,output,names,kind,diagnostic):
                    raise AssertionError(label+' wrong intended HTTP framing failure')
                outcomes.append({'control':label,'outcome':'intended_failure','names':names,'kind':kind,'diagnostic':diagnostic,'exitCode':code})
                for name,c,o,n,k,d,wanted in [('exact',code,output,names,kind,diagnostic,True),
                    ('wrong-exit',0,output,names,kind,diagnostic,False),
                    ('wrong-case',code,output,['unrelated_case'],kind,diagnostic,False),
                    ('wrong-diagnostic',code,output,names,kind,'unrelated diagnostic',False)]:
                    actual=intended(c,o,n,k,d)
                    if actual is not wanted:raise AssertionError('HTTP failure oracle differs')
                    oracles.append({'control':label+'-'+name,'accepted':actual})
            finally:module.write_bytes(original);tests.write_bytes(test_original)
        positive('restored-final',original)
        if module.read_bytes()!=original or tests.read_bytes()!=test_original:
            raise AssertionError('HTTP framing source did not restore')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in [module,tests,Path(__file__)]},indent=2)+'\n')
        print(json.dumps({'positiveCohorts':4,'casesPerPositive':35,'targetedFaults':len(cases),'oracleControls':len(oracles),'sourceRestored':True}))
    finally:module.write_bytes(original);tests.write_bytes(test_original)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
