"""Challenge owned CLI behavior serially, restoring source and tests."""
import argparse,ast,hashlib,importlib.util,inspect,json,os,subprocess,sys,types
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def require_census(cases,raw):
    census={node.name for node in ast.walk(ast.parse(raw)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[1] for row in cases}!=census:raise ValueError('Every owned CLI test needs a declared fault')
    return census


def challenge_census(cases,raw,helper):
    def probe(check):
        check(cases,raw);check(list(reversed(cases)),raw+'\n# Harmless census note.\n')
        try:check(cases,raw+'\ndef test_missing_mapping():pass\n')
        except ValueError as error:
            if str(error)!='Every owned CLI test needs a declared fault':raise
        else:raise AssertionError('Census accepted an unmapped CLI test')
    probe(require_census)
    scope={'ast':ast};code=helper.disable(inspect.getsource(require_census),'Every owned CLI test needs a declared fault')
    exec(compile(code,'<broken census guard>','exec'),scope)
    try:probe(scope['require_census'])
    except AssertionError as error:
        if str(error)!='Census accepted an unmapped CLI test':raise
    else:raise AssertionError('Missing census guard was not detected')
    return {'positiveControls':2,'unmappedCaseRefused':True,'removedGuard':'intended_failure',
        'blindCategory':'Other files and dynamically generated methods are outside this static source census.'}


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    folder=repo/'workers/odm_worker';source=folder/'runtime_service_cli.py';tests=folder/'test_runtime_service_cli.py'
    original={path:path.read_bytes() for path in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','service_fault_helpers')
    oracle=load(repo/'docs/reviews/2026-10-14-outcome-recovery/verify_controls.py','service_failure_oracle')
    base=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','service_failure_base')
    def swap(before,after):return lambda text:helper.swap(text,before,after)
    cases=[]
    def add(label,test,change,reason):cases.append((label,'test_'+test,change,reason))
    def unsafe_document(text):
        tree=ast.parse(text);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='document')
        lines=text.splitlines(keepends=True)
        lines[node.lineno-1:node.end_lineno]=["def document(path):\n    import json\n    from pathlib import Path\n    return json.loads(Path(path).read_bytes())\n"]
        return ''.join(lines)
    add('exact-document','private_canonical_document_reads_exactly',swap("        raise ValueError('Operator input must be complete canonical JSON')\n    return value","        raise ValueError('Operator input must be complete canonical JSON')\n    return {}"),'Canonical private input must load')
    for label,test in [('relative','relative_document_refuses'),('symlink','alias_document_refuses'),('hardlink','hardlinked_document_refuses'),('private-file','shared_file_refuses')]:
        add(label,test,unsafe_document,'ValueError not raised')
    add('private-parent','shared_parent_refuses_before_read',swap('path=absolute(path);private(path.parent,True)','path=absolute(path)'),'ValueError not raised')
    add('input-bound','oversized_document_refuses_before_allocation',swap('LIMIT=64*1024','LIMIT=128*1024'),'Oversized command cannot read contents')
    add('canonical-json','noncanonical_document_refuses',swap('len(raw)!=info.st_size or raw!=json_bytes(value)','len(raw)!=info.st_size'),'ValueError not raised')
    add('short-input','short_document_read_refuses',swap('len(raw)!=info.st_size or raw!=json_bytes(value)','raw!=json_bytes(value)'),'ValueError not raised')
    add('inbound-role','role_graph_resolves_exact_original_values',swap("inbound=token(secrets['inboundToken'])","inbound='changed'"),'Inbound credential must keep explicit value')
    add('required-role','missing_credential_role_refuses',swap('def adapters(settings,secrets,presets):',"def adapters(settings,secrets,presets):\n    secrets.setdefault('callback',{settings['callbackCredentialReference']:'synthetic-default'})"),'ValueError not raised')
    add('exact-reference-set','extra_credential_reference_refuses',swap('set(values)!={reference}','reference not in values'),'ValueError not raised')
    add('printable-credential','non_printable_credential_refuses',lambda text:helper.disable(text,'Operator credential differs'),'ValueError not raised')
    add('runtime-reference','foreign_runtime_reference_refuses',lambda text:helper.disable(text,'Original CLI credential reference differs'),'ValueError not raised')
    add('preset-roster','preset_names_must_be_complete',lambda text:helper.disable(text,'Explicit preset names differ'),'ValueError not raised')
    add('duplicate-options','duplicate_options_refuse',lambda text:helper.disable(text,'Explicit preset option names repeat'),'ValueError not raised')
    add('finite-options','nonfinite_options_refuse',lambda text:helper.disable(text,'Explicit preset option value differs'),'ValueError not raised')
    add('input-snapshot','original_adapter_values_do_not_follow_input_mutation',swap('saved=copy.deepcopy(presets)','saved=presets'),'Original options remain pinned')
    add('credential-copy','original_adapter_values_do_not_follow_input_mutation',swap('return copy.deepcopy(value)','return value'),'Original credential copy stays pinned')
    add('balanced-preset','missing_request_preset_uses_explicit_balanced_options',swap("preset=request.get('presetId') or 'balanced'","preset=request.get('presetId') or 'fast-preview'"),'Contract default uses explicit balanced options')
    add('unknown-preset','unknown_request_preset_refuses',swap("if preset not in saved:raise ValueError('Original CLI preset differs')","if preset not in saved:return []"),'ValueError not raised')
    add('argument-log','argument_failure_does_not_echo_values',swap("def error(self,message):raise ValueError('Explicit worker command arguments differ')","def error(self,message):\n        print(message,file=sys.stderr)\n        raise ValueError('Explicit worker command arguments differ')"),'Command errors cannot echo supplied arguments')
    add('provider-log','failure_does_not_echo_provider_or_file_errors',swap('    except Exception:\n        print(',"    except Exception as error:\n        print(str(error),file=sys.stderr)\n        print("),'Run errors cannot echo private provider data')
    restore_line='            for kind,handler in previous.items():signal.signal(kind,handler)'
    add('signal-restore','original_signal_handlers_restore_after_run',swap(restore_line,'            pass'),'CLI restores original signal handlers')
    add('cleanup-restore','signal_handlers_restore_even_when_server_close_fails',swap('        try:service.stop();server.server_close()\n        finally:\n'+restore_line,'        service.stop();server.server_close()\n        for kind,handler in previous.items():signal.signal(kind,handler)'),'Cleanup errors cannot retain CLI signal handlers')
    add('actual-child-stop','actual_child_admits_replays_and_stops_without_processing',swap('        try:service.run()',"        try:service.run();(_ for _ in ()).throw(ValueError('synthetic-exit-fault'))"),'Explicit child stops through owned service')
    add('requested-stop','operator_interruption_is_graceful',swap('requested_stop=True;service.stop()','requested_stop=False;service.stop()'),'Requested interruption must stop the explicit command gracefully')
    add('unexpected-stop','unrequested_interruption_stays_failed',swap('if not requested_stop:raise','if False:raise'),'InterruptedError not raised')
    add('other-errors','operator_stop_does_not_hide_other_errors',swap('except InterruptedError:','except Exception:'),'ValueError not raised')
    add('admission-phase','actual_child_admits_replays_and_stops_without_processing',swap('        try:service.run()',"        try:\n            service.run()\n            for entry in service.bundle.runtime.journal.accepted():service.bundle.runtime.journal.start(entry.request['requestId'],entry.job_reference,{})"),'Idle child cannot invent a processing start')
    add('direct-command','direct_command_help_starts_no_service',swap("if __name__=='__main__':sys.exit(main())","if __name__=='__main__':sys.exit(2)"),'Direct command exposes its operator help')
    add('option-input','invalid_option_shapes_and_bounds_refuse',swap('    for rows in presets.values():','    presets={key:([] if value is None else value) for key,value in presets.items()}\n    for rows in presets.values():'),'Invalid option input cannot reach service assembly')
    add('option-list-type','invalid_option_shapes_and_bounds_refuse',swap('not isinstance(rows,list) or len(rows)>128','rows is None or len(rows)>128'),'Invalid option input cannot reach service assembly')
    add('option-list-bound','invalid_option_shapes_and_bounds_refuse',swap('len(rows)>128','len(rows)>256'),'Invalid option input cannot reach service assembly')
    add('option-row-fields','invalid_option_shapes_and_bounds_refuse',swap("set(row)!={'name','value'}","not {'name','value'}.issubset(row)"),'Invalid option input cannot reach service assembly')
    add('option-name-empty','invalid_option_shapes_and_bounds_refuse',swap('not 1<=len(name)<=128','not 0<=len(name)<=128'),'Invalid option input cannot reach service assembly')
    add('option-name-bound','invalid_option_shapes_and_bounds_refuse',swap('not 1<=len(name)<=128','not 1<=len(name)<=256'),'Invalid option input cannot reach service assembly')
    add('option-value-type','invalid_option_shapes_and_bounds_refuse',swap('type(value) not in (str,int,float,bool)','False'),'Invalid option input cannot reach service assembly')
    add('option-value-bound','invalid_option_shapes_and_bounds_refuse',swap('len(value)>4096','len(value)>8192'),'Invalid option input cannot reach service assembly')
    add('role-shape','invalid_role_token_shapes_refuse',swap('        value=values[reference]',"        value=values[reference]\n        if role=='engine' and value==42:value=None"),'Invalid role credential cannot reach service assembly')
    add('service-wire','command_passes_exact_private_graph_to_service',swap('max_queued=args.max_queued,','max_queued=1,'),'Command passes explicit address and queue bound')
    census=require_census(cases,original[tests])
    (out/'census-controls.json').write_text(json.dumps(challenge_census(cases,original[tests].decode(),helper),indent=2)+'\n')
    records=[]
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,target=None):
        result=subprocess.run([sys.executable,'-B','-m','unittest','test_runtime_service_cli'+('.Checks.'+target if target else '')],
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
            if label=='exact-document':
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
