"""Exercise original HTTP guards with restored source and real owned fixtures."""
import argparse,ast,hashlib,json,os,re,subprocess,sys
from pathlib import Path


def replace(text,before,after):
 if text.count(before)!=1:raise ValueError('HTTP mutation anchor is not unique: '+before[:80])
 return text.replace(before,after,1)


def guard(text,message,occurrence=0):
 lines=text.splitlines(keepends=True);found=[i for i,line in enumerate(lines) if "raise ValueError('"+message+"')" in line]
 if occurrence>=len(found):raise ValueError('HTTP guard anchor is missing')
 index=found[occurrence]
 if lines[index].lstrip().startswith('if '):
  lines[index]=lines[index].split('if ',1)[0]+'if False:'+lines[index].split(':',1)[1]
 else:
  index-=1;indent=lines[index][:len(lines[index])-len(lines[index].lstrip())];lines[index]=indent+'if False:\n'
 return ''.join(lines)


def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700);source=repo/'workers/odm_worker/draft_http.py';tests=source.with_name('test_draft_http.py');original=source.read_bytes();test_before=tests.read_bytes();text=original.decode();census={n.name for n in ast.walk(ast.parse(test_before)) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')};cases=[]
 def add(label,test,transform,reason,kind='broken_behavior'):cases.append((label,test,transform,reason,kind))
 def disabled(message,occurrence=0):return lambda s:guard(s,message,occurrence)
 swap=lambda before,after:lambda s:replace(s,before,after)
 no_cancel=swap("        if decision:\n            raise InterruptedError('Original draft HTTP transport cancelled')","        if False:\n            raise InterruptedError('Original draft HTTP transport cancelled')")
 no_timeout=swap('    if time.monotonic() >= deadline:', '    if False:')
 no_loop_bound=swap('                            if len(target)+len(chunk) > limit:', '                            if False:')
 add('original-status-replaced','test_actual_init_preserves_fields_header_and_credential',swap("    return value['status'], body","    return 201, body"),'Exact original HTTP status and body must return')
 add('original-uuid-header-omitted','test_actual_init_preserves_fields_header_and_credential',swap("        for name, value in command.get('headers', {}).items():connection.putheader(name, value)",'        pass # original UUID header omitted'),"'set-uuid'")
 add('credential-query-omitted','test_actual_init_preserves_fields_header_and_credential',swap("path = endpoint.path+command['path']+('?' + urlencode({'token': token}) if token is not None else '')","path = endpoint.path+command['path']"),"synthetic token+only")
 add('initialization-multipart-type-removed','test_actual_init_preserves_fields_header_and_credential',swap("content_type = 'multipart/form-data; boundary='+boundary","content_type = 'application/x-www-form-urlencoded' if command['path']=='/task/new/init' else 'multipart/form-data; boundary='+boundary"),'Pinned engine initialization requires multipart fields')
 add('original-initialization-fields-replaced','test_actual_init_preserves_fields_header_and_credential',swap("+value.encode()+b'\\r\\n' for name,value","+b'changed'+b'\\r\\n' for name,value"),'Original initialization fields must reach multipart unchanged')
 add('original-upload-body-replaced','test_actual_upload_preserves_original_image_and_filename',swap('checksum.update(chunk);connection.send(chunk);remaining -= len(chunk)',"checksum.update(chunk);connection.send(b'x'*len(chunk));remaining -= len(chunk)"),'Original image bytes must reach multipart unchanged')
 add('original-filename-replaced','test_actual_upload_preserves_original_image_and_filename',swap('filename="{command["multipart"]["filename"]}"','filename="changed.jpg"'),'original.jpg')
 add('pre-cancel-ignored','test_pre_cancelled_transport_refuses_before_credentials_or_spawn',no_cancel,'Precancelled transport spawned child')
 add('response-cancel-ignored','test_actual_response_cancellation_closes_connection_and_reaps_child',no_cancel,'Original draft HTTP deadline exceeded','diagnostic_refusal')
 add('changed-engine-accepted','test_changed_engine_refuses_before_credentials_or_spawn',disabled('Original HTTP engine identity differs'),'Changed engine spawned child')
 add('commit-path-accepted','test_commit_command_never_reaches_credentials_or_spawn',disabled('Only original init/upload HTTP commands are permitted',1),'Commit spawned child')
 add('invalid-deadline-accepted','test_invalid_deadline_refuses_before_credentials_or_spawn',disabled('Original HTTP deadline must be finite'),'Invalid deadline resolved credentials')
 add('expired-deadline-accepted','test_invalid_deadline_refuses_before_credentials_or_spawn',no_timeout,'Invalid deadline spawned child')
 add('implicit-cancellation-type','test_cancellation_adapter_requires_exact_boolean',disabled('HTTP cancellation adapter must return a boolean'),'ValueError not raised')
 add('invalid-credential-value-accepted','test_credentials_refuse_invalid_values_and_keep_diagnostics_private',disabled('Original engine credential value differs'),'ValueError not raised')
 add('credential-diagnostic-leaks','test_credentials_refuse_invalid_values_and_keep_diagnostics_private',swap("            raise ValueError('Original engine credential resolution failed') from None","            raise ValueError('Synthetic private credential detail') from None"),'does not match')
 add('parent-metadata-bound-ignored','test_metadata_bound_precedes_child_launch',disabled('Original HTTP metadata exceeds its bound',0),'Oversized metadata spawned child')
 add('streamed-hash-ignored','test_streamed_hash_mismatch_cannot_finish_multipart',disabled('Original HTTP streamed image hash differs'),'RuntimeError not raised')
 add('response-envelope-ignored','test_response_envelope_duplicate_keys_and_base64_refuse',disabled('Original HTTP child response envelope differs'),'ValueError not raised')
 add('duplicate-response-keys-accepted','test_response_envelope_duplicate_keys_and_base64_refuse',disabled('Original HTTP child response has duplicate keys'),'ValueError not raised')
 add('invalid-base64-accepted','test_response_envelope_duplicate_keys_and_base64_refuse',swap("base64.b64decode(value['bodyBase64'], validate=True)","base64.b64decode(value['bodyBase64'], validate=False)"),'ValueError not raised')
 add('decoded-wire-bound-ignored','test_response_bounds_refuse_before_or_after_decoding',disabled('Original HTTP child output exceeds its bound',0),'Oversized wire reached JSON parser')
 add('decoded-body-bound-ignored','test_response_bounds_refuse_before_or_after_decoding',disabled('Original HTTP response exceeds its bound',0),'ValueError not raised')
 add('actual-child-body-bound-ignored','test_actual_oversized_response_refuses_from_child',disabled('Original HTTP response exceeds its bound',1),'Original HTTP response exceeds its bound','diagnostic_refusal')
 add('credential-replaces-engine-snapshot','test_credential_adapter_cannot_replace_original_engine_snapshot',swap("metadata = json.dumps({'engine': original_engine,", "metadata = json.dumps({'engine': self.engine,"),'Original draft HTTP child failed')
 add('implicit-platform-or-adapters','test_constructor_requires_linux_and_callable_adapters',disabled('Linux original HTTP supervision and explicit adapters are required'),'ValueError not raised')
 add('non-post-command-reaches-credentials','test_initialization_shape_and_fields_refuse_before_credentials',disabled('Only original init/upload HTTP commands are permitted',0),'Invalid initialization reached credentials')
 add('initialization-shape-ignored','test_initialization_shape_and_fields_refuse_before_credentials',disabled('Original HTTP initialization shape differs'),'Invalid initialization reached credentials')
 add('initialization-fields-ignored','test_initialization_shape_and_fields_refuse_before_credentials',disabled('Original HTTP initialization fields differ'),'Invalid initialization reached credentials')
 add('upload-descriptor-ignored','test_upload_descriptors_refuse_before_credentials',disabled('Original HTTP upload descriptor differs'),'Invalid upload reached credentials')
 add('short-stream-accepted','test_short_or_nonbyte_stream_refuses_and_stops_child',disabled('Original HTTP image stream ended early or differs'),'Original draft HTTP deadline exceeded','diagnostic_refusal')
 add('extra-image-byte-ignored','test_extra_image_byte_refuses_complete_stream_claim',disabled('Original HTTP image stream exceeds its descriptor'),'ValueError not raised')
 add('response-deadline-ignored','test_actual_response_deadline_stops_owned_child',no_timeout,'Original draft HTTP child failed','diagnostic_refusal')
 add('resolver-stop-not-reaped','test_stalled_resolver_cannot_start_a_late_request',swap('        process.wait(timeout=5)','        pass # child exit is not observed'),'Stalled resolver child must be reaped before return')
 add('live-child-not-signalled','test_owned_stop_signals_before_waiting',swap('            process.kill()','            pass # live child stop omitted'),'Owned live child wait preceded its stop signal')
 add('exited-child-signalled','test_owned_stop_never_signals_an_exited_child',swap('        if process.poll() is None:','        if True:'),'Exited child received another signal')
 add('body-cancel-ignored','test_actual_body_cancellation_stops_a_partial_upload',no_cancel,'Original draft HTTP deadline exceeded','diagnostic_refusal')
 add('runtime-init-cannot-acknowledge','test_actual_runtime_bridge_saves_original_replies_and_holds_commit',swap("    return value['status'], body","    return 201, body"),'Engine reply status, byte type or bound is invalid','diagnostic_refusal')
 add('parent-lifetime-stop-removed','test_abrupt_parent_exit_stops_and_reaps_owned_http_child',swap('        os._exit(97)','        return # original owner death ignored'),'Parent exit must stop the owned HTTP child')
 add('child-output-bound-ignored','test_child_stdout_and_stderr_bounds_precede_response_decode',no_loop_bound,'Oversized child output reached response decoder')
 add('child-metadata-bound-ignored','test_child_metadata_bound_precedes_payload_read',disabled('Original HTTP metadata exceeds its bound',1),'Oversized child metadata reached payload read')
 add('child-frame-eof-ignored','test_incomplete_child_frame_refuses_at_original_eof',disabled('Original HTTP child input is incomplete'),'Incomplete child input continued after original EOF')
 add('unrelated-environment-inherited','test_child_environment_does_not_inherit_unrelated_credentials',swap("if key in {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}","if True"),'HTTP child cannot inherit unrelated credentials')
 add('incomplete-json-reply-accepted','test_incomplete_content_length_refuses_valid_json_prefix',disabled('Original HTTP response is incomplete'),'RuntimeError not raised')
 add('incomplete-empty-reply-accepted','test_incomplete_content_length_refuses_empty_prefix',disabled('Original HTTP response is incomplete'),'RuntimeError not raised')
 add('complete-close-delimiter-refused','test_complete_close_delimited_reply_preserves_exact_bytes',swap('        if response.length not in (None, 0):','        if response.length not in (0,):'),'Original draft HTTP child failed')
 add('complete-empty-frame-refused','test_complete_zero_length_reply_is_not_a_framing_error',swap('        if response.length not in (None, 0):',"        if not body:\n            raise ValueError('Empty HTTP body refused')\n        if response.length not in (None, 0):"),'Original draft HTTP child failed')
 if {row[1] for row in cases}!=census:raise AssertionError('HTTP test lacks targeted control: '+repr(sorted(census-{row[1] for row in cases})))
 rows=[]
 def execute(label,test=None):
  r=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=12,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'});output=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return r.returncode,output
 def positive(label,payload):
  source.write_bytes(payload);code,output=execute(label)
  if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': positive HTTP control failed\n'+output)
  rows.append({'control':label,'outcome':'survived'})
 try:
  positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless original HTTP control.\n');positive('restored-after-harmless',original)
  for label,test,transform,reason,kind in cases:
   try:
    changed=transform(text);ast.parse(changed);source.write_text(changed);code,output=execute(label,test)
    lines=output.splitlines();starts=[i for i,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:',line)];diagnostic=''
    if starts:
     blocks=[]
     for start in starts:
      end=next((i for i in range(start+1,len(lines)) if lines[i].startswith('-----') or lines[i].startswith('=====')),len(lines));blocks.append('\n'.join(lines[start:end]))
     diagnostic='\n'.join(blocks)
    if code==0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output) or not starts or reason not in diagnostic:raise AssertionError(label+': wrong HTTP failure '+repr(diagnostic)+'\n'+output)
    rows.append({'control':label,'test':test,'kind':kind,'outcome':'intended_failure','reason':reason})
   finally:source.write_bytes(original)
  positive('restored-final',original)
  if source.read_bytes()!=original or tests.read_bytes()!=test_before:raise AssertionError('HTTP subjects were not restored')
  (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,tests,Path(__file__)]},indent=2)+'\n');print(json.dumps({'tests':len(census),'controls':len(rows),'positive':4,'targeted':len(cases),'allPassed':True}),flush=True)
 finally:
  source.write_bytes(original)
  with source.open('rb') as f:os.fsync(f.fileno())

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.absolute())
