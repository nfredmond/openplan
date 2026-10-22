"""Exact restored-source controls for original ZIP derivation."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def swap(before, after):
    def change(value):
        if value.count(before)!=1: raise ValueError('ZIP mutation anchor is not unique')
        return value.replace(before,after,1)
    return change


def disable(message, occurrence=0):
    def change(value):
        tree=ast.parse(value);parents={child:parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        raises=[node for node in ast.walk(tree) if isinstance(node,ast.Raise) and isinstance(node.exc,ast.Call)
            and node.exc.args and isinstance(node.exc.args[0],ast.Constant) and node.exc.args[0].value==message]
        raises.sort(key=lambda node:node.lineno)
        node=raises[occurrence]
        while not isinstance(node,ast.If): node=parents[node]
        lines=value.splitlines(keepends=True);prefix=sum(map(len,lines[:node.test.lineno-1]))+node.test.col_offset
        end=sum(map(len,lines[:node.test.end_lineno-1]))+node.test.end_col_offset
        return value[:prefix]+'False'+value[end:]
    return change


def cases():
    rows=[]
    def add(label,test,transform,reason,kind='broken_behavior'): rows.append((label,'test_'+test,transform,reason,kind))
    add('changed-original-order','exact_ordered_bytes_and_distinct_basenames',swap('entries.sort(key=lambda value:value[0].orig_filename)','entries.sort(key=lambda value:value[0].orig_filename, reverse=True)'), 'deterministic original order')
    add('original-download-required','replay_needs_no_original_download',swap('receipt = retain(**source_arguments);original',"digest(source_arguments['source_root'],source_arguments['sources'][0],source_arguments['max_bytes'],deadline)\n    receipt = retain(**source_arguments);original"),'original.zip')
    add('missing-original-slot-not-recovered','missing_slot_recovers_from_retained_original_zip',swap('if not target.exists() and not target.is_symlink():',"if not target.exists() and not target.is_symlink() and not (destination/'manifest.json').exists():"),'image-00001.bin')
    add('changed-derived-identity','changed_context_and_limits_refuse',disable('Saved derived ZIP identity differs'),'ValueError not raised')
    add('changed-derived-record','changed_derived_plan_mapping_refuses',disable('Saved derived ZIP record differs'),'Derived bytes read before saved-plan validation')
    add('changed-derived-shape','changed_derived_plan_shape_and_identity_refuse',disable('Saved derived ZIP identity differs'),'Existing source custody record differs','diagnostic_refusal')
    add('changed-derived-census','changed_derived_plan_shape_and_identity_refuse',disable('Saved derived ZIP mapping differs'),'Retained derived ZIP object mapping differs','diagnostic_refusal')
    add('changed-retained-image','changed_retained_image_refuses',disable('Retained derived ZIP image differs'),'ValueError not raised')
    add('unknown-retained-object','unknown_derived_object_refuses',disable('Retained derived ZIP object mapping differs',0),'Derived object enumeration read beyond declared bound')
    add('changed-final-object-set','late_object_mapping_refuses',disable('Retained derived ZIP object mapping differs',1),'ValueError not raised')
    add('orphan-derived-manifest','manifest_without_original_plan_refuses',disable('Derived ZIP manifest has no original plan'),'ValueError not raised')
    add('public-derived-root','alias_public_and_overlapping_roots_refuse',swap('    private(destination,True)','    pass # privacy omitted'),'ValueError not raised')
    add('overlapping-derived-root','alias_public_and_overlapping_roots_refuse',disable('Original ZIP source and derived roots must not overlap'),'ValueError not raised')
    add('invalid-derived-budgets','invalid_budgets_and_timeout_refuse',swap('for limit in (max_expanded_bytes,max_entries,max_directory_bytes): finite_limit(limit)','pass # budgets omitted'),'Source bytes read before derived budget admission')
    add('invalid-derived-timeout','invalid_budgets_and_timeout_refuse',disable('Derived ZIP timeout must be positive and finite'),'ValueError not raised')
    add('missing-zip-footer','footer_and_comment_guards',disable('Original ZIP footer is missing'),'unpack requires a buffer of 22 bytes','diagnostic_refusal')
    add('wrong-zip-comment','footer_and_comment_guards',disable('Original ZIP footer or comment is inconsistent'),'ValueError not raised')
    add('spanning-zip','spanning_and_extent_guards',disable('Spanning ZIP archives are unsupported'),'ValueError not raised')
    add('changed-directory-extent','spanning_and_extent_guards',disable('Original ZIP directory extent is inconsistent'),'Original ZIP directory record is inconsistent','diagnostic_refusal')
    add('unbounded-directory-index','declared_directory_bounds_precede_zipfile_allocation',disable('Original ZIP directory exceeds its declared bounds'),'ZIP index allocated before directory bounds')
    add('unbounded-actual-count','actual_directory_count_and_record_guards',disable('Actual ZIP directory exceeds its declared bounds'),'Original ZIP directory record count differs','diagnostic_refusal')
    add('changed-directory-count','actual_directory_count_and_record_guards',disable('Original ZIP directory record count differs'),'ValueError not raised')
    add('changed-directory-record','actual_directory_count_and_record_guards',disable('Original ZIP directory record is inconsistent'),'ValueError not raised')
    add('zip64-unsupported','zip64_original_bytes_supported',swap("if len(locator)==20 and locator.startswith(b'PK\\x06\\x07'):",'if False:'),'Original ZIP64 locator is missing')
    add('changed-zip64-locator','zip64_locator_and_footer_guards',disable('Original ZIP64 locator is inconsistent'),'ValueError not raised')
    add('changed-zip64-footer','zip64_locator_and_footer_guards',disable('Original ZIP64 footer is inconsistent'),'ValueError not raised')
    add('contradictory-zip64','zip64_declarations_and_missing_locator_refuse',disable('Original ZIP64 declarations differ'),'ValueError not raised')
    add('missing-zip64-locator','zip64_declarations_and_missing_locator_refuse',disable('Original ZIP64 locator is missing'),'Original ZIP directory exceeds its declared bounds','diagnostic_refusal')
    add('short-zip64-footer','zip64_short_footer_refuses',disable('Original ZIP64 footer is incomplete'),'unpack requires a buffer of 56 bytes','diagnostic_refusal')
    add('expired-directory-deadline','direct_directory_and_expansion_deadlines_refuse',swap('    check_time(deadline)\n    start = max(0, size-65557)','    pass # initial deadline omitted\n    start = max(0, size-65557)'),'TimeoutError not raised')
    add('expired-all-derived-deadlines','direct_directory_and_expansion_deadlines_refuse',lambda value:value.replace('check_time(deadline)','None'),'TimeoutError not raised')
    add('unsafe-zip-member','unsafe_repeated_and_noncanonical_members_refuse',disable('Original ZIP member name is unsafe or repeated'),'ValueError not raised')
    add('encrypted-special-zip-member','encrypted_and_special_members_refuse',disable('Encrypted or special ZIP members are unsupported'),'ValueError not raised')
    add('loaded-index-count','loaded_directory_census_refuses',disable('Loaded ZIP directory count differs'),'ValueError not raised')
    add('no-image-members','no_images_and_expanded_budget_precede_reads',disable('Original ZIP has no selected image members'),'ValueError not raised')
    add('expanded-byte-admission','no_images_and_expanded_budget_precede_reads',disable('Original ZIP images exceed expanded byte budget'),'ZIP bytes read before expanded-budget admission')
    add('actual-expanded-byte-limit','actual_expanded_size_and_budget_guards',disable('Actual ZIP image exceeds expanded byte budget'),'ValueError not raised')
    add('actual-expanded-size','actual_expanded_size_and_budget_guards',disable('Actual ZIP image size differs'),'ValueError not raised')
    add('original-descriptor-hash','original_zip_descriptor_hash_is_rechecked',disable('Original retained ZIP hash differs'),'ValueError not raised')
    add('original-descriptor-size','original_zip_descriptor_size_and_type_guards',disable('Original retained ZIP size differs'),'ValueError not raised')
    add('original-source-type','original_zip_descriptor_size_and_type_guards',disable('One original retained ZIP source is required'),'ValueError not raised')
    add('unverified-slot-published','copied_byte_comparison_precedes_publication',disable('Original planned ZIP image bytes differ'),'Unverified ZIP copy published')
    add('unsynced-slot-published','copy_sync_precedes_fixed_slot',swap('output.flush();os.fsync(output.fileno())','output.flush()'),'OSError not raised')
    add('insufficient-disk-admission','insufficient_disk_refuses_before_copy',disable('Insufficient free space for derived ZIP bytes'),'ValueError not raised')
    add('public-replay-record','original_bytes_and_modes_unchanged_on_replay',swap("publish(destination,'manifest.json',json_bytes(manifest));check_time(deadline)","publish(destination,'manifest.json',json_bytes(manifest));os.chmod(destination/'manifest.json',0o644);check_time(deadline)"),'derived manifest must remain private')
    return rows


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source=repo/'workers/odm_worker/derived_zip.py';tests=repo/'workers/odm_worker/test_derived_zip.py'
    original=source.read_bytes();test_bytes=tests.read_bytes()
    census={node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    rows=cases()
    if {row[1] for row in rows}!=census: raise ValueError('Derived ZIP tests lack targeted controls')
    outcomes=[]
    def execute(label,test=None):
        cwd=out/(label+'-cwd');cwd.mkdir(mode=0o700)
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=cwd,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=15)
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode,output
    def positive(label,harmless=False):
        source.write_bytes(original+(b'\n# Harmless derived ZIP control.\n' if harmless else b''))
        code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError('Derived baseline failed: '+label)
        outcomes.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline');positive('harmless-comment',True);positive('restored-after-harmless')
        for label,test,transform,reason,kind in rows:
            try:
                changed=transform(original.decode());ast.parse(changed);source.write_text(changed)
                code,output=execute(label,test)
                if not code or ('FAIL: '+test not in output and 'ERROR: '+test not in output): raise AssertionError(label+': target did not fail')
                lines=output.splitlines();starts=[i for i,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*[Ee]rror:',line)]
                diagnostic=''
                if starts:
                    end=next((i for i in range(starts[-1]+1,len(lines)) if lines[i].startswith('-----')),len(lines))
                    diagnostic='\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic:raise AssertionError(label+': wrong diagnostic '+repr(diagnostic))
                outcomes.append({'control':label,'test':test,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally: source.write_bytes(original)
        positive('restored-final')
        if source.read_bytes()!=original or tests.read_bytes()!=test_bytes:raise AssertionError('ZIP source changed')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source,tests)},indent=2)+'\n')
        print(json.dumps({'testsCovered':len(census),'controls':len(outcomes),'positive':4,'broken':len(rows)}))
    finally:
        source.write_bytes(original)
        with source.open('rb') as stream:os.fsync(stream.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
