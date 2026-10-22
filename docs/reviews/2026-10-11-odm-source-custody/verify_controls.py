"""Run bounded source-custody mutations with restored source and native fixtures."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def replace(value, before, after):
    if value.count(before) != 1:
        raise ValueError('Mutation anchor is not unique')
    return value.replace(before, after, 1)


def function(value, name, before, after):
    start = value.index('\ndef '+name+'(')+1
    end = value.find('\ndef ',start+1)
    end = len(value) if end == -1 else end
    return value[:start]+replace(value[start:end],before,after)+value[end:]


def scoped(value, name, transform):
    start=value.index('\ndef '+name+'(')+1
    end=value.find('\ndef ',start+1)
    end=len(value) if end==-1 else end
    return value[:start]+transform(value[start:end])+value[end:]


def disable(value, message):
    lines=value.splitlines(keepends=True)
    indexes=[i for i,line in enumerate(lines) if "raise ValueError('"+message+"')" in line]
    if len(indexes)!=1:raise ValueError('Guard anchor is not unique')
    index=indexes[0]-1;line=lines[index]
    lines[index]=line[:len(line)-len(line.lstrip())]+'if False:\n'
    return ''.join(lines)


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source=repo/'workers/odm_worker/retained_source.py'
    tests=repo/'workers/odm_worker/test_retained_source.py'
    original=source.read_bytes();test_original=tests.read_bytes();text=original.decode()
    all_tests={node.name for node in ast.walk(ast.parse(test_original))
               if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,kind='broken_behavior'):
        cases.append((label,test,transform,reason,kind))
    def guard(message):return lambda value:disable(value,message)
    no_plan=guard('Saved source preparation identity differs')
    no_rows=guard('Saved source preparation record differs')
    no_time=lambda value:function(value,'check_time','    if time.monotonic() >= deadline:','    if False:')

    add('wrong-manifest-receipt','test_exact_zip_bytes_and_binding',lambda v:replace(v,"        return {'manifestSha256': hashlib.sha256(json_bytes(manifest)).hexdigest(),","        return {'manifestSha256': '0'*64,"),'receipt must bind actual saved manifest bytes')
    add('reversed-photo-slots','test_photo_manifest_preserves_slots_and_metadata',lambda v:replace(v,"'sources': entries, 'state':", "'sources': list(reversed(entries)), 'state':"),'manifest must preserve original ordered slots')
    add('copy-before-plan','test_plan_and_source_sync_precede_copy',lambda v:replace(v,"            publish(destination, 'plan.json', json_bytes(plan))",'            pass # missing plan publication'),'durable original plan must precede the first source copy')
    add('missing-original-byte-sync','test_plan_and_source_sync_precede_copy',lambda v:replace(v,'        os.fsync(stream.fileno())','        pass # missing original source sync'),'original source bytes must synchronize before source copy')
    add('missing-copied-byte-sync','test_copy_sync_precedes_slot_publication',lambda v:replace(v,'                    output.flush();os.fsync(output.fileno())','                    output.flush()'),'copied source bytes must synchronize before slot publication')
    add('first-slot-tamper-accepted','test_slot_tampering_before_first_manifest_refuses',guard('Retained source slot differs'),'ValueError not raised')
    add('replay-adds-partial','test_complete_replay_without_original_sources_is_unchanged',lambda v:function(v,'publish','        return','        (root/(".partial-"+uuid.uuid4().hex)).write_bytes(payload)\n        return'),'completed replay must not create new partial records')
    add('path-bound-receipt','test_relocated_complete_pack_keeps_identity',lambda v:replace(v,"        return {'manifestSha256': hashlib.sha256(json_bytes(manifest)).hexdigest(),","        return {'manifestSha256': hashlib.sha256(json_bytes(manifest)+str(destination).encode()).hexdigest(),"),'relocated complete pack must retain original identity')
    add('cached-slot-recopies-source','test_partial_plan_resumes_only_missing_slots',lambda v:replace(v,'            if not target.exists() and not target.is_symlink():','            if True:'),'first-source')
    add('changed-original-late-refusal','test_prepared_plan_refuses_changed_original_bytes',guard('Original planned source bytes differ'),'does not match','diagnostic_refusal')
    add('missing-manifest-directory-sync','test_manifest_acknowledgment_loss_replays_original',lambda v:function(v,'publish','\n    synchronize(root)\n','\n    pass # missing final publication sync\n'),'OSError not raised')
    for test in ('test_changed_original_context_refuses','test_changed_original_request_refuses','test_changed_mapping_or_budget_refuses'):
        transform=no_rows if test=='test_changed_mapping_or_budget_refuses' else no_plan
        if test == 'test_changed_mapping_or_budget_refuses':
            add('changed-source-mapping',test,transform,'ValueError not raised')
        else:
            add('late-identity-refusal-'+test,test,transform,'does not match','diagnostic_refusal')
    add('missing-original-authority','test_original_context_required_and_scope_bound',guard('Original source authority context is required'),'ValueError not raised')
    add('foreign-authority-scope','test_original_context_required_and_scope_bound',guard('Source authority geography/job scope differs'),'ValueError not raised')
    add('caller-context-alias','test_caller_and_returned_values_are_detached',lambda v:replace(v,"    return json.loads(encoded({'requestId': request_id, 'jobReference': reference,", "    return ({'requestId': request_id, 'jobReference': reference,") .replace("'originalContext': context}, canonical=True))","'originalContext': context})",1),'caller context must not alias saved binding')
    add('foreign-job-admitted','test_original_admission_required',lambda v:replace(v,'    if admission is None or admission.job_reference != reference:','    if admission is None:'),'ValueError not raised')
    add('nonfinite-context','test_context_nonfinite_json_refuses',lambda v:replace(v,"    return json.loads(encoded({'requestId': request_id, 'jobReference': reference,","    context = {k: val for k, val in context.items() if k != 'unknown'}\n    return json.loads(encoded({'requestId': request_id, 'jobReference': reference,"),'ValueError not raised')
    add('boolean-source-limit','test_limit_and_timeout_guards',lambda v:replace(v,' or isinstance(value, bool)',''),'ValueError not raised')
    add('invalid-timeout','test_limit_and_timeout_guards',guard('Source custody timeout must be positive and finite'),'TimeoutError:','diagnostic_refusal')
    add('missing-source-mapping-check','test_source_mapping_and_paths_refuse',guard('Exact original source mapping is required'),'ValueError not raised')
    add('missing-source-path-check','test_source_mapping_and_paths_refuse',lambda v:scoped(scoped(v,'prepare',guard('Source relative path is unsafe')),'reader',guard('Source relative path is unsafe')),'No such file','diagnostic_refusal')
    add('unknown-imagery-as-zip','test_unsupported_imagery_shape_refuses',lambda v:replace(v,'    if imagery.get(\'type\') == \'zip_url\':','    if True:'),'ValueError not raised')
    add('source-size-late-refusal','test_aggregate_byte_limit_refuses',lambda v:replace(replace(v,'        if before.st_size > limit:','        if False:'),'            if size > limit:','            if False:'),'does not match','diagnostic_refusal')
    add('missing-declared-size','test_declared_size_refuses_mismatch_and_boolean',guard('Source bytes differ from declared size'),'ValueError not raised')
    add('missing-photo-checksum','test_declared_photo_checksum_refuses',guard('Source bytes differ from declared checksum'),'ValueError not raised')
    add('relative-destination','test_absolute_alias_and_parent_guards',lambda v:replace(v,'    if not path.is_absolute() or \'..\' in path.parts or any(item.is_symlink() for item in [path, *path.parents]):','    if False:'),'ValueError not raised')
    add('public-original-root','test_public_source_root_and_file_refuse',lambda v:v.replace('private(source_root, True)','None'),'ValueError not raised')
    add('public-original-file','test_public_source_root_and_file_refuse',lambda v:replace(v,' or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:',' or info.st_uid != os.getuid() or False:'),'ValueError not raised')
    add('public-nested-directory','test_nested_public_source_directory_refuses',guard('Source directory must be private and owned'),'ValueError not raised')
    add('foreign-original-owner','test_foreign_source_owner_refuses',lambda v:function(v,'reader',' or info.st_uid != os.getuid()',' or False'),'ValueError not raised')
    add('public-destination-parent','test_public_destination_parent_refuses',lambda v:replace(v,'destination = absolute(destination);private(destination.parent, True)','destination = absolute(destination)'),'ValueError not raised')
    add('source-hardlink','test_symlink_hardlink_and_special_source_refuse',lambda v:replace(v,' or info.st_nlink != 1',' or False'),'ValueError not raised')
    add('special-source-kernel-refusal','test_symlink_hardlink_and_special_source_refuse',lambda v:replace(v,'not stat.S_ISREG(info.st_mode)','False'),'Invalid argument','diagnostic_refusal')
    add('missing-source-stability','test_source_changed_during_hash_refuses',guard('Source file changed during custody'),'ValueError not raised')
    add('expired-deadline','test_expired_deadline_refuses',no_time,'TimeoutError not raised')
    add('busy-writer-not-locked','test_busy_writer_refuses_with_bounded_lock',lambda v:replace(v,'                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB);locked = True','                locked = True'),'TimeoutError not raised')
    add('missing-disk-admission','test_disk_budget_refuses',guard('Insufficient free space for retained source bytes'),'ValueError not raised')
    add('unknown-plan-late-refusal','test_saved_plan_and_encoding_corruption_refuse',no_plan,'does not match','diagnostic_refusal')
    add('changed-plan-encoding','test_saved_plan_and_encoding_corruption_refuse',guard('Source custody metadata encoding differs'),'ValueError not raised')
    add('corrupt-source-row-late-refusal','test_saved_source_row_and_aggregate_corruption_refuse',no_rows,'does not match','diagnostic_refusal')
    add('unbounded-saved-total','test_saved_source_row_and_aggregate_corruption_refuse',guard('Saved source preparation exceeds original limit'),'does not match','diagnostic_refusal')
    add('missing-saved-mapping-count','test_saved_source_mapping_count_refuses',guard('Saved source preparation mapping differs'),'does not match','diagnostic_refusal')
    add('numeric-boolean-binding-equality','test_json_type_changes_do_not_rebind_plan',lambda v:replace(v,"encoded(plan['binding'], canonical=True) != encoded(bound, canonical=True)","plan['binding'] != bound"),'ValueError not raised')
    add('numeric-float-metadata-equality','test_json_type_changes_do_not_rebind_plan',lambda v:replace(v,"encoded(row['imageryMetadata'], canonical=True) != encoded(metadata[index], canonical=True)","row['imageryMetadata'] != metadata[index]"),'ValueError not raised')
    add('unbounded-metadata-read-diagnostic','test_metadata_read_and_publication_size_bounds',lambda v:scoped(v,'read_json',guard('Source custody metadata exceeds the supported size')),'does not match','diagnostic_refusal')
    add('unbounded-metadata-publication','test_metadata_read_and_publication_size_bounds',lambda v:scoped(v,'publish',guard('Source custody metadata exceeds the supported size')),'ValueError not raised')
    add('explicit-publication-bound-ignored','test_explicit_publication_limit_preserves_the_default',lambda v:replace(v,'bound = JSON_LIMIT if json_limit is None else json_limit','bound = JSON_LIMIT'),'Source custody metadata exceeds the supported size','diagnostic_refusal')
    add('invalid-publication-bound-accepted','test_publication_limit_requires_a_positive_bounded_integer',lambda v:scoped(v,'publish',guard('Source custody publication limit must be a positive bounded integer')),'ValueError not raised')
    add('missing-completed-plan','test_missing_plan_in_complete_pack_refuses',guard('Completed source custody has no preparation plan'),'ValueError not raised')
    add('corrupt-slot-late-refusal','test_corrupt_slot_and_extra_object_refuse',guard('Retained source slot differs'),'does not match','diagnostic_refusal')
    add('extra-source-object','test_corrupt_slot_and_extra_object_refuse',guard('Retained source object mapping differs'),'ValueError not raised')
    add('overwrite-manifest','test_existing_manifest_is_never_overwritten',lambda v:function(v,'publish','    if target.exists() or target.is_symlink():','    if False:'),'ValueError not raised')
    add('public-output-mode-late-refusal','test_private_files_do_not_depend_on_caller_umask',lambda v:v.replace('os.O_NOFOLLOW, 0o600)', 'os.O_NOFOLLOW, 0o644)'),'Source file must be private and owned','diagnostic_refusal')

    covered={row[1] for row in cases}
    if covered!=all_tests:raise ValueError('Changed source tests lack controls: '+repr(sorted(all_tests-covered)))
    outcomes=[]
    def execute(label,test=None):
        args=[sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else [])
        cwd=out/(label+'-cwd');cwd.mkdir(mode=0o700)
        result=subprocess.run(args,cwd=cwd,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=15)
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode,output
    def positive(label,payload):
        source.write_bytes(payload);code,output=execute(label)
        if code or 'Ran '+str(len(all_tests))+' tests' not in output:raise AssertionError(label+': positive control failed')
        outcomes.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline',original)
        positive('harmless-comment',original+b'\n# Harmless source-custody proof comment.\n')
        positive('restored-after-harmless',original)
        for label,test,transform,reason,kind in cases:
            try:
                mutated=transform(text);ast.parse(mutated);source.write_text(mutated)
                code,output=execute(label,test)
                if code==0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output):raise AssertionError(label+': targeted test did not fail')
                lines=output.splitlines();starts=[i for i,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:',line)]
                diagnostic=''
                if starts:
                    end=next((i for i in range(starts[-1]+1,len(lines)) if lines[i].startswith('------')),len(lines))
                    diagnostic='\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic:raise AssertionError(label+': wrong failure: '+repr(diagnostic))
                outcomes.append({'control':label,'test':test,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally:source.write_bytes(original)
        positive('restored-final',original)
        if source.read_bytes()!=original or tests.read_bytes()!=test_original:raise AssertionError('Source or tests were not restored')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original).hexdigest(),'testsSha256':hashlib.sha256(test_original).hexdigest()},indent=2)+'\n')
        print(json.dumps({'controls':len(outcomes),'positive':4,'broken':len(cases),'testsCovered':len(covered)}))
    finally:
        source.write_bytes(original)
        fd=os.open(source,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
