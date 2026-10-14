"""Challenge the local failure-summary checker without mutating worker files."""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import re


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


def run(repo,out):
    out.mkdir(parents=True,exist_ok=False)
    source=repo/'docs/reviews/2026-10-14-outcome-recovery/verify_controls.py'
    raw=source.read_text();tree=ast.parse(raw)
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='intended_failure')
    function=ast.get_source_segment(raw,node)
    base=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','oracle_base').intended_failure
    sample='ERROR: test_target (checks.Checks.test_target)\nAssertionError: intended diagnostic\n----------------------------------------------------------------------\nRan 1 test in 0.001s\n\nFAILED (errors=1)\n'
    controls=[]
    def check(text):
        scope={'re':re};exec(text,scope)
        call=lambda code,log:scope['intended_failure'](code,log,'test_target','intended diagnostic',base)
        assert call(1,sample),'Valid failure survives summary check'
        assert not call(2,sample),'Wrong exit cannot satisfy summary check'
        assert not call(1,sample.replace('errors=1','errors=0')),'Zero counts cannot satisfy summary check'
        assert not call(1,sample+'FAILED (errors=1)\n'),'Duplicate summary cannot satisfy summary check'
        assert not call(1,sample+'Ran 1 test in 0.001s\n'),'Duplicate count cannot satisfy summary check'
        assert not call(1,sample.replace('errors=1','errors=2')),'Mismatched counts cannot satisfy summary check'
        assert not call(1,sample.replace('errors=1','failures=1')),'Wrong header kind cannot satisfy summary check'
    def positive(label,text):
        check(text);controls.append({'control':label,'outcome':'survived'})
    positive('baseline',function);positive('harmless',function+'\n# Harmless oracle note.\n');positive('restored-after-harmless',function)
    faults=[('upstream-validation',function.replace('if not base(code,log,target,reason):return False','if False:return False'),'Wrong exit cannot satisfy summary check'),
        ('unique-summary',function.replace("if runs!=['1'] or len(summaries)!=1:return False",'if False:return False'),'Duplicate summary cannot satisfy summary check'),
        ('positive-count',function.replace("return (sum(counts.values())>0 and counts.get('failures',0)==headers.count('FAIL')\n            and counts.get('errors',0)==headers.count('ERROR'))",'return True'),'Zero counts cannot satisfy summary check'),
        ('matching-counts',function.replace("return (sum(counts.values())>0 and counts.get('failures',0)==headers.count('FAIL')\n            and counts.get('errors',0)==headers.count('ERROR'))",'return sum(counts.values())>0'),'Mismatched counts cannot satisfy summary check'),
        ('header-kind',function.replace("return (sum(counts.values())>0 and counts.get('failures',0)==headers.count('FAIL')\n            and counts.get('errors',0)==headers.count('ERROR'))",'return sum(counts.values())>0 and sum(counts.values())==len(headers)'),'Wrong header kind cannot satisfy summary check')]
    for label,text,expected in faults:
        assert text!=function,'Oracle fault changes executable code'
        try:check(text)
        except AssertionError as error:
            assert str(error)==expected,'Oracle fault must reach its intended diagnostic'
        else:raise AssertionError('Oracle fault survived: '+label)
        controls.append({'control':label,'outcome':'intended_failure','reason':expected})
    positive('restored-final',function)
    (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
    (out/'binding.json').write_text(json.dumps({'controllerSha256':hashlib.sha256(source.read_bytes()).hexdigest()},indent=2)+'\n')
    print({'positive':4,'faults':5})

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
