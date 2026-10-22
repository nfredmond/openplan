"""Actual composed HTTP cancellation, with harmless and severed-signal controls."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    helper_path=repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec=importlib.util.spec_from_file_location('composed_http_fault_helper',helper_path);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    source=repo/'workers/odm_worker/runtime_url_draft.py';tests=source.with_name('test_runtime_url_draft_cancellation.py')
    original=source.read_bytes();test_bytes=tests.read_bytes();rows=[]
    census={node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    def severed(adapter):
        before='deadline=time.monotonic()+self.timeout;self.intake._check(request_id,deadline)'
        after='deadline=time.monotonic()+self.timeout;self.intake.cancelled=lambda:False;'+adapter+'.cancelled=lambda:False;self.intake._check(request_id,deadline)'
        return helper.replace(original.decode(),before,after)
    def changed_test(before,after):return helper.replace(test_bytes.decode(),before,after)
    cases=[('source-signal-severed','test_actual_source_body_cancellation_stops_before_engine','source',lambda:severed('self.intake.fetch'),'Source transport deadline exceeded'),
        ('engine-signal-severed','test_actual_engine_body_cancellation_retains_unresolved_original_intent','source',lambda:severed('self.transport'),'Original draft HTTP deadline exceeded'),
        ('actual-fin-ignored','test_peer_observer_accepts_actual_fin','tests',lambda:changed_test("    try:return connection.recv(1)==b''","    try:return connection.recv(1)==b'x'"),'Actual TCP EOF must count as a closed peer'),
        ('actual-reset-ignored','test_peer_observer_accepts_actual_reset','tests',lambda:changed_test('    except ConnectionResetError:return True','    except ConnectionResetError:raise'),'Connection reset by peer'),
        ('received-data-called-closed','test_peer_observer_rejects_actual_available_bytes','tests',lambda:changed_test("    try:return connection.recv(1)==b''","    try:return True"),'Received bytes cannot count as peer closure'),
        ('timeout-called-closed','test_peer_observer_propagates_actual_timeout','tests',lambda:changed_test('    except ConnectionResetError:return True','    except OSError:return True'),'TimeoutError not raised')]
    if {row[1] for row in cases}!=census:raise ValueError('Composed HTTP tests lack controls')
    def execute(label,test=None):
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=12,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return result.returncode,output
    def positive(label,payload):
        source.write_bytes(payload);tests.write_bytes(test_bytes);code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': composed HTTP positive control failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless composed HTTP comment.\n');positive('restored-after-harmless',original)
        for label,test,subject,transform,reason in cases:
            try:
                changed=transform();ast.parse(changed);(source if subject=='source' else tests).write_text(changed)
                code,output=execute(label,test)
                try:helper.verify_failure(test,code,output,reason)
                except ValueError:raise AssertionError(label+': wrong composed HTTP failure\n'+output) from None
                rows.append({'control':label,'test':test,'outcome':'intended_failure','reason':reason})
            finally:source.write_bytes(original);tests.write_bytes(test_bytes)
        positive('restored-final',original)
        if source.read_bytes()!=original or tests.read_bytes()!=test_bytes:raise AssertionError('Composed HTTP restoration differs')
        paths=[source,tests,helper_path,Path(__file__),repo/'workers/odm_worker/draft_http.py',repo/'workers/odm_worker/url_transport.py']
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},indent=2)+'\n')
        print(json.dumps({'tests':len(census),'controls':len(rows),'positive':4,'targeted':len(cases),'actualComposedHTTPCancellation':True}))
    finally:
        source.write_bytes(original);tests.write_bytes(test_bytes)
        with source.open('rb') as stream:os.fsync(stream.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
