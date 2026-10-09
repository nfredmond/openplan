"""Check stage output path enforcement with harmless and targeted controls."""
import hashlib
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
from test_model_skip_dispatch import aeq


def main():
    names=['stage_artifacts','prepare_primary_model_output','publish_volume_geojson','retain_model_evidence_packet']
    sources={name:inspect.getsource(getattr(aeq,name)) for name in names}
    cases=[('baseline',None,None,None),('harmless','stage_artifacts',sources['stage_artifacts']+'\n# Harmless comment.\n',None)]
    for name,target in [('retain_model_evidence_packet','test_evidence_packet_uses_working_outputs'),('stage_artifacts','test_artifact_counts_use_confirmed_output_directory'),('prepare_primary_model_output','test_primary_preparation_uses_working_volume_file'),('publish_volume_geojson','test_volume_publication_refuses_unprepared_outputs_before_database')]:
        source=sources[name]
        old='output_work_directory(work_dir)'
        if source.count(old)!=1:raise AssertionError('Output stage anchor changed')
        cases.append(('legacy-path-'+name,name,source.replace(old,'os.path.join(work_dir, "run_output")'),target))
    cases.append(('restored',None,None,None))
    runner='''
import sys,unittest
from types import FunctionType
from test_model_skip_dispatch import aeq
if sys.argv[2]:
 namespace=dict(aeq.__dict__)
 exec(compile(open(sys.argv[1]).read(),'<output-path-control>','exec'),namespace)
 setattr(aeq,sys.argv[2],FunctionType(namespace[sys.argv[2]].__code__,aeq.__dict__,argdefs=namespace[sys.argv[2]].__defaults__))
 getattr(aeq,sys.argv[2]).__kwdefaults__=namespace[sys.argv[2]].__kwdefaults__
name='test_output_execution_path'+('.OutputPathTests.'+sys.argv[3] if sys.argv[3] else '')
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
'''
    records=[]
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'candidate.py'
        for name,function,body,target in cases:
            path.write_text(body or '')
            r=subprocess.run([sys.executable,'-B','-c',runner,str(path),function or '',target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
            if target:
                if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+' missed target: '+r.stderr)
            elif r.returncode:raise AssertionError(name+' failed: '+r.stderr)
            records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
    report={'worker_sha256':hashlib.sha256((WORKER/'main.py').read_bytes()).hexdigest(),'controls':records,'limits':'Actual artifact entry points with prepared output copies; package and project prerequisites mocked in focused tests. No complete extraction, publication, full dispatch or scientific acceptance.'}
    (ROOT/'output-execution-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
