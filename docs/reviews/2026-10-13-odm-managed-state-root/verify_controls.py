"""Mutate managed-root configuration and startup while restoring exact source."""
import argparse
import ast
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys


def replace(value,before,after):
    if value.count(before)!=1:raise ValueError('State-root mutation anchor is not unique')
    return value.replace(before,after,1)


def remove_guard(value,message):
    tree=ast.parse(value);found=[]
    for node in ast.walk(tree):
        if isinstance(node,ast.If):
            for statement in node.body:
                if isinstance(statement,ast.Raise) and isinstance(statement.exc,ast.Call) and statement.exc.args and isinstance(statement.exc.args[0],ast.Constant) and statement.exc.args[0].value==message:found.append(node)
    if len(found)!=1:raise ValueError('State-root guard anchor is not unique')
    found[0].test=ast.Constant(False)
    return ast.unparse(tree)+'\n'


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source=repo/'workers/odm_worker/main.py';tests=repo/'workers/odm_worker/test_managed_state_root.py';old_tests=tests.with_name('test_runtime_admission.py')
    original=source.read_bytes();text=original.decode();test_bytes={path:path.read_bytes() for path in (tests,old_tests)}
    census={node.name for node in ast.walk(ast.parse(test_bytes[tests])) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,file=tests,kind='broken_behavior'):cases.append((label,test,transform,reason,file,kind))
    def swap(before,after):return lambda value:replace(value,before,after)
    def guard(message):return lambda value:remove_guard(value,message)
    missing=swap("raise ValueError('ODM_WORKER_MANAGED_STATE_DIR is required for managed admission')", "value = '/srv/synthetic-managed-state'")
    add('missing-state-falls-back','test_managed_mode_requires_declared_state',missing,'ValueError not raised')
    add('nonstring-state-falls-back','test_root_value_requires_nonempty_string',missing,'ValueError not raised')
    add('relative-root-accepted','test_relative_state_refuses',guard('ODM managed state directory must be absolute'),'ValueError not raised')
    add('scratch-trees-overlap','test_state_and_scratch_trees_do_not_overlap',guard('ODM managed state and scratch directories must not overlap'),'ValueError not raised')
    add('scratch-alias-not-resolved','test_alias_and_normalized_scratch_refuse',swap('root = requested.resolve()','root = requested.absolute()'),'ValueError not raised')
    add('default-scratch-accepted','test_default_scratch_is_not_a_managed_state_root',guard('ODM managed state cannot use the default scratch directory'),'ValueError not raised')
    add('declared-root-lost','test_explicit_state_keeps_scratch_separate_without_creating_it',swap('"managed_state_dir": state_dir','"managed_state_dir": ""'),'Configuration must retain the declared managed state root')
    add('legacy-default-changed','test_unmanaged_mode_keeps_existing_scratch_default',swap('"work_dir": work_dir','"work_dir": "/synthetic-changed-scratch"'),'Unmanaged scratch default must remain compatible')
    add('startup-recheck-skipped','test_startup_rechecks_before_runtime_and_scratch',swap("state_dir = managed_state_directory(CONFIG['managed_state_dir'], CONFIG['work_dir']) if CONFIG['managed_admission'] else None", "state_dir = CONFIG['managed_state_dir'] if CONFIG['managed_admission'] else None"),'Invalid managed state reached runtime',kind='diagnostic_refusal')
    add('config-recheck-skipped','test_managed_mode_requires_declared_state',swap('state_dir = managed_state_directory(state_dir, work_dir)','state_dir = state_dir'),'ValueError not raised')
    add('runtime-uses-scratch','test_actual_main_attaches_runtime_and_owns_root_before_serving',swap('ADMISSIONS = Runtime(state_dir,',"ADMISSIONS = Runtime(CONFIG['work_dir'],"),'main must reopen the declared original state, not scratch',file=old_tests)
    add('implicit-mode-restored','test_managed_configuration_requires_explicit_mode',guard('ODM_WORKER_MANAGED_ADMISSION must be 0 or 1'),'ValueError not raised',file=old_tests)
    add('scratch-created-before-state-check','test_missing_state_refuses_without_creating_root_or_scratch',lambda value:replace(value,'    os.makedirs(CONFIG["work_dir"], mode=0o700, exist_ok=True)\n','').replace("    if CONFIG['managed_admission']:\n", "    os.makedirs(CONFIG[\"work_dir\"], mode=0o700, exist_ok=True)\n    if CONFIG['managed_admission']:\n",1),'Missing retained state must refuse before scratch creation')
    if {row[1] for row in cases if row[4]==tests}!=census:raise ValueError('New state-root tests lack controls')
    rows=[]
    def execute(label,file,test=None):
        result=subprocess.run([sys.executable,'-B',str(file)]+(['Checks.'+test] if test else []),cwd=out,capture_output=True,timeout=30,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode,output
    def positive(label,payload):
        source.write_bytes(payload)
        for file in (tests,old_tests):
            code,output=execute(label+'-'+file.stem,file)
            if code:raise AssertionError(label+' baseline failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless managed-state declaration control.\n');positive('restored-after-harmless',original)
        for label,test,transform,reason,file,kind in cases:
            try:
                changed=transform(text);ast.parse(changed);source.write_text(changed)
                code,output=execute(label,file,test)
                lines=output.splitlines();starts=[index for index,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:',line)]
                diagnostic=''
                if starts:
                    end=next((index for index in range(starts[-1]+1,len(lines)) if lines[index].startswith('-----')),len(lines))
                    diagnostic='\n'.join(lines[starts[-1]:end])
                if code==0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output) or reason not in diagnostic:raise AssertionError('Wrong managed-root failure: '+label+'\n'+output)
                rows.append({'control':label,'test':test,'outcome':'intended_failure','reason':reason,'kind':kind})
            finally:source.write_bytes(original)
        positive('restored-final',original)
        if source.read_bytes()!=original or any(path.read_bytes()!=data for path,data in test_bytes.items()):raise AssertionError('State-root source or tests changed')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source,tests,old_tests)},indent=2)+'\n')
        print(json.dumps({'controls':len(rows),'survivors':4,'faults':len(cases),'newTestsCovered':len(census)}))
    finally:
        source.write_bytes(original)
        with source.open('rb') as stream:os.fsync(stream.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
