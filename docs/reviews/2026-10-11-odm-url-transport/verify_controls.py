"""Harmless and targeted source transport controls with exact restoration."""
import argparse,ast,hashlib,json,os,re,subprocess,sys
from pathlib import Path


def replace(text,before,after):
    if text.count(before)!=1:raise ValueError('Transport mutation anchor is not unique: '+before[:80])
    return text.replace(before,after,1)


def disable(text,message,function=None):
    tree=ast.parse(text)
    scope=tree if function is None else next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name==function)
    nodes=[node.test for node in ast.walk(scope) if isinstance(node,ast.If) and any(isinstance(row,ast.Raise) and isinstance(row.exc,ast.Call) and row.exc.args and isinstance(row.exc.args[0],ast.Constant) and row.exc.args[0].value==message for row in node.body)]
    if len(nodes)!=1:raise ValueError('Transport guard mutation is not unique: '+message)
    node=nodes[0];lines=text.splitlines(keepends=True)
    start=sum(map(len,lines[:node.lineno-1]))+node.col_offset;end=sum(map(len,lines[:node.end_lineno-1]))+node.end_col_offset
    return text[:start]+'False'+text[end:]


def verify_failure(test,code,output,reasons):
    lines=output.splitlines();starts=[i for i,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:',line)];blocks=[]
    for start in starts:
        end=next((i for i in range(start+1,len(lines)) if lines[i].startswith('-----') or lines[i].startswith('=====')),len(lines))
        blocks.append('\n'.join(lines[start:end]))
    allowed=list(reasons) if isinstance(reasons,tuple) else [reasons]
    if code==0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output) or not blocks or any(not any(reason in block for reason in allowed) for block in blocks):
        raise ValueError('Transport failure is not the intended result')


def oracle_controls(test,code,output,reason):
    rows=[]
    for label,value in [('baseline',output),('harmless-note',output+'\n# Harmless oracle note.\n'),('restored',str(output))]:
        verify_failure(test,code,value,reason);rows.append({'control':label,'outcome':'survived'})
    for label,bad_code,bad_output in [('zero-exit',0,output),('wrong-test',code,output.replace('FAIL: '+test,'FAIL: unrelated_test')),
        ('wrong-reason',code,output.replace(reason,'UNEXPECTED_REASON')),('extra-unexpected-failure',code,output+'\nValueError: UNEXPECTED_SECONDARY_FAILURE\n'),
        ('missing-error-block',code,output.replace('AssertionError:','UnrecognizedFault:'))]:
        try:verify_failure(test,bad_code,bad_output,reason)
        except ValueError as error:
            if str(error)!='Transport failure is not the intended result':raise
            rows.append({'control':label,'outcome':'intended_refusal'})
        else:raise AssertionError('Broken transport failure oracle survived')
    return rows


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source=repo/'workers/odm_worker/url_transport.py';tests=source.with_name('test_url_transport.py')
    original=source.read_bytes();before_tests=tests.read_bytes();text=original.decode()
    census={node.name for node in ast.walk(ast.parse(before_tests)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,kind='broken_behavior'):cases.append((label,'test_'+test,transform,reason,kind))
    guard=lambda message,function=None:lambda source:disable(source,message,function)
    swap=lambda before,after:lambda source:replace(source,before,after)
    no_cancel=guard('Source transport cancelled');no_expiry=guard('Source transport deadline exceeded')
    no_finish=guard('Source transport did not complete')
    no_resolve=guard('Source URL resolved address is not approved')
    add('returned-count-changed','actual_exact_get_and_proxy_independence',swap('            return count','            return count+1'),'Exact source bytes and count must return')
    add('stored-payload-changed','actual_exact_get_and_proxy_independence',swap('output.write(payload)','output.write(b"z"*len(payload))'),'Exact source bytes and count must return')
    add('original-query-omitted','actual_exact_get_and_proxy_independence',swap("('?' + parts.query if parts.query else '')","''"),'Original signed query must reach the source')
    add('encoded-request-header','actual_exact_get_and_proxy_independence',swap("'Accept-Encoding':'identity'","'Accept-Encoding':'gzip'"),"'gzip' != 'identity'")
    add('stream-count-changed','actual_chunked_and_unknown_length',swap('            return count','            return count+1'),'AssertionError:')
    add('redirect-target-changed','approved_redirect_closes_unread_body',swap('target=urljoin(url,locations[0])',"target=urljoin(url,'/different')"),'AssertionError:')
    add('redirect-address-not-checked','redirect_address_checked_before_connection',no_resolve,'ValueError not raised')
    add('redirect-ceiling-refusal-omitted','redirect_limit_and_port_checked',guard('Source redirect differs'),'Redirect child must refuse at its original ceiling','diagnostic_refusal')
    add('url-syntax-not-checked','invalid_urls_refuse_before_spawn',guard('Source URL syntax differs','parse_url'),'Invalid URL spawned')
    add('url-authority-not-checked','invalid_urls_refuse_before_spawn',guard('Source URL scheme, host or credentials differ'),('Invalid URL spawned',"argument of type 'NoneType' is not"),'diagnostic_refusal')
    add('url-port-not-checked','invalid_urls_refuse_before_spawn',guard('Source URL port is not approved'),'Invalid URL spawned')
    add('scoped-host-not-checked','invalid_urls_refuse_before_spawn',guard('Source URL host differs'),'Invalid URL spawned')
    add('pre-cancel-not-checked','pre_cancelled_refuses_before_spawn',no_cancel,'Cancelled source spawned')
    add('deadline-type-not-checked','expired_or_nonfinite_deadline_refuses_before_spawn',guard('Source transport deadline must be finite'),('deadline must be finite','Source transport deadline exceeded'),'diagnostic_refusal')
    add('expiry-not-checked','expired_or_nonfinite_deadline_refuses_before_spawn',no_expiry,'Expired source spawned')
    add('cancellation-type-not-checked','invalid_cancellation_type_refuses',guard('Source transport cancellation must be a boolean'),'Source transport cancelled','diagnostic_refusal')
    add('constructor-adapter-not-checked','invalid_constructor_policy',guard('Linux source supervision and cancellation are required'),'ValueError not raised')
    add('constructor-policy-not-checked','invalid_constructor_policy',guard('Explicit source address policy is required'),'ValueError not raised')
    add('constructor-redirect-not-checked','invalid_constructor_policy',guard('Source redirect limit differs'),'ValueError not raised')
    add('constructor-trust-path-not-checked','invalid_constructor_policy',guard('Source TLS trust file must be an absolute path'),'ValueError not raised')
    add('byte-limit-not-checked','invalid_byte_limit_or_writer_refuses_before_spawn',guard('Source transport byte limit differs'),'Invalid byte writer spawned')
    add('writer-not-checked','invalid_byte_limit_or_writer_refuses_before_spawn',guard('Source transport requires a byte writer'),'Invalid byte writer spawned')
    add('parent-metadata-limit-not-checked','metadata_bound_refuses_before_spawn',guard('Source transport metadata exceeds its bound','__call__'),'Oversized metadata spawned')
    add('public-address-filter-omitted','address_policy_public_and_explicit_local',swap("    return (value.is_global and not value.is_reserved) or any(value.version == net.version and value in net for net in networks)","    return True"),('Only public unicast is permitted by default','True is not false'))
    add('unicast-filter-omitted','address_policy_public_and_explicit_local',swap("if value.is_unspecified or value.is_multicast or getattr(value, 'ipv4_mapped', None) is not None:","if False:"),('Only public unicast is permitted by default','True is not false'))
    add('translated-address-filter-omitted','address_policy_public_and_explicit_local',swap('    if value.version == 6 and value in NAT64:return False','    if False:return False'),'Explicit networks cannot admit translated IPv4 aliases')
    add('mixed-dns-answers-not-checked','all_dns_answers_must_pass_policy',no_resolve,'ValueError not raised')
    add('pinned-socket-omitted','pinned_connection_does_not_resolve_again',swap('        result.sock=handle','        result.sock=None'),'Pinned connection resolved again')
    add('response-status-not-checked','incomplete_encoded_ambiguous_or_partial_response_refuses',guard('Source response status differs'),'ValueError not raised')
    add('child-length-match-not-checked','incomplete_encoded_ambiguous_or_partial_response_refuses',guard('Source response ended before its declared length'),'ValueError not raised')
    add('child-overflow-not-checked','declared_and_actual_overflow_never_write_excess',guard('Source response bytes exceed their bound','child'),'Source transport bytes exceed their bound','diagnostic_refusal')
    add('active-cancellation-not-checked','actual_cancellation_reaps_child_and_closes_headers_and_body',no_cancel,'Source transport deadline exceeded','diagnostic_refusal')
    add('active-deadline-not-checked','actual_deadline_reaps_stalled_response',no_expiry,'Source transport did not complete','diagnostic_refusal')
    add('frame-shape-not-checked','parent_frame_and_completion_checks',guard('Source transport frame differs'),('frame differs','ValueError not raised'),'diagnostic_refusal')
    add('completion-hash-not-checked','parent_frame_and_completion_checks',guard('Source transport completion differs'),'ValueError not raised')
    add('missing-completion-accepted','parent_frame_and_completion_checks',no_finish,'ValueError not raised')
    add('parent-byte-limit-not-checked','parent_bounds_supplied_child_and_short_local_write',guard('Source transport bytes exceed their bound'),'Source transport did not complete','diagnostic_refusal')
    add('short-local-write-not-checked','parent_bounds_supplied_child_and_short_local_write',guard('Source transport local write did not finish'),'Source transport did not complete','diagnostic_refusal')
    add('response-shape-not-checked','response_shape_refuses_before_body',guard('Source response encoding or length differs'),'ValueError not raised')
    add('response-numeric-length-not-checked','response_shape_refuses_before_body',guard('Source response length differs'),'ValueError not raised')
    add('response-declared-cap-not-checked','response_shape_refuses_before_body',guard('Source response bytes exceed their bound','response_length'),'ValueError not raised')
    add('actual-child-overflow-not-checked','child_actual_overflow_refuses_without_parent_guard',guard('Source response bytes exceed their bound','child'),'Oversized child must refuse before a byte frame')
    add('child-invocation-not-checked','invalid_child_invocation_refuses_before_request',guard('Owned source child invocation is required'),'Invalid child invocation must refuse before input')
    add('child-metadata-cap-not-checked','child_diagnostics_and_metadata_bound',guard('Source transport metadata exceeds its bound','child'),'Oversized child metadata must refuse')
    add('child-private-diagnostics-exposed','child_diagnostics_and_metadata_bound',swap("sys.stderr.write('Original source transport failed\\n')","sys.stderr.write(str(sys.exc_info()[1])+'\\n')"),'Child diagnostics cannot expose a private trust path')
    add('parent-diagnostic-cap-not-checked','parent_diagnostic_bound',guard('Source transport diagnostics exceed their bound'),'Source transport did not complete','diagnostic_refusal')
    add('unrelated-credentials-inherited','child_environment_has_no_unrelated_credentials',swap("if key in {'PATH','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR'}","if True"),'Source child cannot inherit unrelated credentials')
    add('source-bridge-wrong-count','actual_source_receipts_and_preparation_use_complete_bytes_once',swap('            return count','            return count+1'),'URL source fetch count differs from delivered bytes','diagnostic_refusal')
    add('source-cancellation-type-changed','actual_source_cancelled_body_has_no_complete_receipt',swap("if decision:raise InterruptedError('Source transport cancelled')","if decision:raise ValueError('Broken source cancellation completion')"),'Broken source cancellation completion','diagnostic_refusal')
    add('tls-trust-disabled','actual_tls_checks_original_host_and_explicit_trust',swap('ssl.create_default_context(cafile=ca_file)','ssl._create_unverified_context(cafile=ca_file)'),'ValueError not raised')
    add('tls-host-verification-disabled','actual_tls_wrong_host_and_downgrade_refuse',swap('ssl.create_default_context(cafile=ca_file)','ssl._create_unverified_context(cafile=ca_file)'),'ValueError not raised')
    add('tls-downgrade-not-checked','actual_tls_wrong_host_and_downgrade_refuse',guard('Source HTTPS redirect downgrade refused'),'ValueError not raised')
    add('dns-child-not-awaited','stalled_dns_cancellation_prevents_late_request',swap('                DraftTransport._stop(process)','                pass # owned child not awaited'),'Cancelled DNS child must be awaited before return')
    def no_signals(source):
        return replace(replace(source,'            os.close(lifetime_write)','            pass # lifetime signal omitted'),'                DraftTransport._stop(process)','                process.wait(timeout=5)')
    add('dns-stop-signals-omitted','stalled_dns_cancellation_prevents_late_request',no_signals,'Abandoned DNS cannot start a late request')
    add('parent-lifetime-watch-omitted','abrupt_parent_exit_stops_and_reaps_owned_source_child',swap('    threading.Thread(target=watch_parent,args=(lifetime,),daemon=True).start()','    pass # lifetime watch omitted'),'Parent exit must stop the owned source child')
    if {row[1] for row in cases}!=census:raise AssertionError('Transport tests lack controls: '+repr(sorted(census-{row[1] for row in cases})))
    rows=[]
    def execute(label,test=None):
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=25,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return result.returncode,output
    def positive(label,payload):
        source.write_bytes(payload);code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': positive transport control failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless original source transport control.\n');positive('restored-after-harmless',original)
        for label,test,transform,reason,kind in cases:
            try:
                changed=transform(text);ast.parse(changed);source.write_text(changed);code,output=execute(label,test)
                try:verify_failure(test,code,output,reason)
                except ValueError:raise AssertionError(label+': wrong transport failure\n'+output) from None
                if label=='returned-count-changed':
                    (out/'failure-oracle-controls.json').write_text(json.dumps(oracle_controls(test,code,output,reason),indent=2)+'\n')
                rows.append({'control':label,'test':test,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally:source.write_bytes(original)
        positive('restored-final',original)
        if source.read_bytes()!=original or tests.read_bytes()!=before_tests:raise AssertionError('Source transport files were not restored')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source,tests,Path(__file__))},indent=2)+'\n')
        print(json.dumps({'tests':len(census),'controls':len(rows),'positive':4,'targeted':len(cases),'allPassed':True}),flush=True)
    finally:
        source.write_bytes(original)
        with source.open('rb') as f:os.fsync(f.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
