"""Challenge owned service behavior serially, restoring source and tests."""
import argparse,ast,hashlib,importlib.util,inspect,json,os,subprocess,sys,types
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def require_census(cases,raw):
    census={node.name for node in ast.walk(ast.parse(raw)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[1] for row in cases}!=census:raise ValueError('Every owned service test needs a declared fault')
    return census


def challenge_census(cases,raw,helper):
    def probe(check):
        check(cases,raw);check(list(reversed(cases)),raw+'\n# Harmless census note.\n')
        try:check(cases,raw+'\ndef test_missing_mapping():pass\n')
        except ValueError as error:
            if str(error)!='Every owned service test needs a declared fault':raise
        else:raise AssertionError('Census accepted an unmapped service test')
    probe(require_census)
    scope={'ast':ast};code=helper.disable(inspect.getsource(require_census),'Every owned service test needs a declared fault')
    exec(compile(code,'<broken census guard>','exec'),scope)
    try:probe(scope['require_census'])
    except AssertionError as error:
        if str(error)!='Census accepted an unmapped service test':raise
    else:raise AssertionError('Missing census guard was not detected')
    return {'positiveControls':2,'unmappedCaseRefused':True,'removedGuard':'intended_failure',
        'blindCategory':'Other files and dynamically generated methods are outside this static source census.'}


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    folder=repo/'workers/odm_worker';source=folder/'runtime_service.py';tests=folder/'test_runtime_service.py'
    original={path:path.read_bytes() for path in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','service_fault_helpers')
    oracle=load(repo/'docs/reviews/2026-10-14-outcome-recovery/verify_controls.py','service_failure_oracle')
    base=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','service_failure_base')
    def swap(before,after):return lambda text:helper.swap(text,before,after)
    cases=[]
    def add(label,test,change,reason):cases.append((label,'test_'+test,change,reason))
    add('health-claim','owned_idle_health_does_not_resolve_credentials',swap("'verification':'process_only'","'verification':'application_verified'"),'Health remains process-only evidence')
    add('receipt-replay','actual_admission_replays_one_original_receipt',swap('202 if first else 200','202'),'Actual admission distinguishes original and replay')
    add('inbound-bearer','wrong_or_non_ascii_bearer_cannot_admit',swap("if not hmac.compare_digest(presented.encode('utf-8'),('Bearer '+self.server.inbound_token).encode('ascii')):",'if False:'),'Wrong inbound bearer refuses before admission')
    add('identity-conflict','changed_original_payload_refuses',swap("except IdentityConflict:self._send_json(409,","except IdentityConflict:self._send_json(200,"),'Changed original identity receives conflict')
    add('queue-full','full_original_queue_refuses_new_request',swap("except QueueFull:self._send_json(503,","except QueueFull:self._send_json(200,"),'Full original queue refuses new work')
    add('json-refusal','malformed_json_refuses',swap("self._send_json(400,{'error':'invalid_request_body'})","self._send_json(422,{'error':'invalid_request_body'})"),'Malformed bytes cannot become an admission')
    add('contract','contract_invalid_body_refuses',swap('if issues:','if False:'),'Invalid contract refuses before journal')
    add('body-size','oversized_body_cannot_admit',swap('if not 0<length<=self.server.max_body:','if False:'),'Declared oversized body cannot become an admission')
    framing="if (self.headers.get('Transfer-Encoding') is not None or len(lengths)!=1\n                or not lengths[0].isascii() or not lengths[0].isdigit()\n                or len(lengths[0])>10):"
    add('framing','transfer_encoding_refuses',swap(framing,'if False:'),'Ambiguous framing cannot become an admission')
    add('header-deadline','dripping_headers_have_absolute_deadline',swap('self._header_timer.daemon=True;self._header_timer.start()','self._header_timer.daemon=True'),'Actual dripping header deadline did not close')
    add('body-deadline','dripping_body_has_absolute_deadline',swap('left=deadline-time.monotonic()','left=self.server.socket_timeout'),'Actual dripping body deadline did not close')
    add('actual-shutdown','stop_closes_body_and_joins_handlers_before_owner_release',swap('server.close_connections()','pass'),'Stop cannot leave an active original handler')
    add('active-bundle-cancel','stop_closes_body_and_joins_handlers_before_owner_release',swap('cancelled=self.stopping.is_set','cancelled=lambda:False'),'Owned stop reaches actual Bundle cancellation')
    add('inbound-config','inbound_credential_refuses_before_seal',lambda text:helper.disable(text,'Explicit service address and inbound credential are required'),'ValueError not raised')
    add('resource-config','resource_bound_refuses_before_seal',lambda text:helper.disable(text,'Explicit service resource bounds differ'),'ValueError not raised')
    add('poll-bound','platform_poll_bound_refuses_before_seal',lambda text:helper.disable(text,'Explicit service poll interval differs'),'ValueError not raised')
    add('caller-cancel','caller_cancellation_adapter_refuses',lambda text:helper.disable(text,'Explicit service owns its cancellation adapter'),'Caller cancellation cannot reach Bundle construction')
    add('lifetime-owner','lifetime_owner_precedes_listener',swap('with bundle.owner():',"with __import__('contextlib').nullcontext():"),'Original listener cannot bind without lifetime owner')
    add('inactive-check','inactive_check_refuses_before_bundle_read',lambda text:helper.disable(text,'Original service is not active'),'Inactive service cannot read Bundle configuration')
    add('connection-slots','connection_slots_bound_actual_handlers',swap('if not self.slots.acquire(blocking=False):','if not self.slots.acquire(blocking=False) and False:'),'Admission thread limit cannot answer a second request')
    add('pre-stopped','pre_stopped_service_cannot_listen',lambda text:helper.disable(text,'Original service stopped before listening'),'InterruptedError not raised')
    add('changed-settings','changed_resource_setting_refuses_actual_health',lambda text:helper.disable(text,'Original service settings changed'),'Changed service settings cannot answer healthy')
    add('changed-components','replaced_cancellation_event_refuses_actual_health',lambda text:helper.disable(text,'Original service components changed'),'Changed service components cannot answer healthy')
    add('second-run','second_run_refuses',lambda text:helper.disable(text,'Original service can run only once'),'Repeated service cannot reenter original owner')
    add('stage-cancel','scheduler_failure_stops_original_listener',swap('self.stop();self.ready.clear()','self.ready.clear()'),'Stage failure cancels owned transports')
    add('thread-start','failed_http_thread_start_does_not_shutdown_unstarted_loop',swap('if started:server.shutdown()','if thread is not None:server.shutdown()'),'Unstarted HTTP loop cannot be shut down')
    add('handler-owner-retention','delayed_admission_keeps_owner_until_handler_exits',swap('if time.monotonic()>=deadline:self._accepted_service.shutdown_delayed.set()',
        "if time.monotonic()>=deadline:self._accepted_service.shutdown_delayed.set();raise TimeoutError('Original handlers did not stop')"),'Delayed original handler must retain lifetime owner')
    add('cached-service-role','replaced_cached_service_cannot_authenticate',lambda text:helper.disable(text,'Original HTTP service role changed'),'Changed cached service cannot admit with replacement credential')
    def old_cached_role(text):
        text=helper.swap(text,'return self._accepted_service','return self._service')
        text=helper.swap(text,"('Bearer '+self.server.inbound_token).encode('ascii')","('Bearer '+service.inbound_token).encode('ascii')")
        return helper.disable(text,'Original HTTP service role changed')
    add('old-cached-authentication','replaced_cached_service_cannot_authenticate',old_cached_role,'Changed cached service cannot admit with replacement credential')
    add('pre-guard-socket-bound','changed_socket_setting_cannot_widen_header_deadline',swap('def socket_timeout(self):return self._accepted_bounds[0]',
        'def socket_timeout(self):return self._accepted_service.socket_timeout'),'Changed socket settings cannot widen header deadline')
    add('actual-sqlite-unavailable','actual_sqlite_contention_returns_unavailable',swap('except (ValueError,OSError,InterruptedError,sqlite3.Error):self._send_json(503,',
        'except (ValueError,OSError,InterruptedError):self._send_json(503,'),'Actual SQLite contention must return structured unavailable')
    cleanup='''                    try:
                        if started:server.shutdown()
                    finally:
                        try:server.close_connections()
                        finally:
                            try:
                                if started:
                                    thread.join(2)
                                    if thread.is_alive():raise TimeoutError('Original HTTP service did not stop')
                            finally:server.join_handlers()'''
    abandoned='''                    if started:server.shutdown()
                    server.close_connections()
                    if started:thread.join(2)
                    server.join_handlers()'''
    add('shutdown-error-drain','shutdown_error_still_drains_original_handlers',swap(cleanup,abandoned),'Failed shutdown must drain original admission')
    census=require_census(cases,original[tests])
    (out/'census-controls.json').write_text(json.dumps(challenge_census(cases,original[tests].decode(),helper),indent=2)+'\n')
    records=[]
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,target=None):
        result=subprocess.run([sys.executable,'-B','-m','unittest','test_runtime_service'+('.Checks.'+target if target else '')],
            cwd=folder,capture_output=True,timeout=30,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log)
        return result.returncode,log
    def positive(label):
        code,log=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in log:raise AssertionError(label+' differs\n'+log)
        records.append({'control':label,'outcome':'survived','cases':len(census)});print(label+' survived',flush=True)
    try:
        positive('baseline');source.write_bytes(original[source]+b'\n# Harmless owned service note.\n')
        positive('harmless');restore();positive('restored-after-harmless')
        for label,target,change,reason in cases:
            restore();source.write_text(change(original[source].decode()));code,log=execute(label,target)
            if not oracle.intended_failure(code,log,target,reason,base.intended_failure):
                raise AssertionError(label+' intended diagnostic differs\n'+log)
            records.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason})
            if label=='health-claim':
                wrapper=types.SimpleNamespace(intended_failure=lambda code,text,test,message:oracle.intended_failure(code,text,test,message,base.intended_failure))
                checks=helper.challenge_oracle(wrapper,code,log,target,reason)
                (out/'oracle-controls.json').write_text(json.dumps(checks,indent=2)+'\n')
            print(label+' intended failure',flush=True)
        restore();positive('restored-final')
        (out/'controls.json').write_text(json.dumps(records,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(raw).hexdigest() for path,raw in original.items()},indent=2)+'\n')
    finally:restore()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
