"""Native reopen controls preserve separate per-case project files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parent


def main():
    script=ROOT/'verify_native_project_working.py'
    source=script.read_text()
    anchor='copied=Path(aeq.project_work_directory(str(root)))'
    if source.count(anchor)!=1:raise AssertionError('Native resolver anchor changed')
    output=Path(os.environ['OPENPLAN_PROJECT_COPY_PROOF_OUTPUT'])
    output.mkdir(mode=0o700,exist_ok=False)
    records=[]
    cases=[('baseline',source),('harmless',source+'\n# Harmless comment.\n'),
           ('retained-input-as-working',source.replace(anchor,"copied=Path(consumed['package_directory'])")),('restored',source)]
    for name,body in cases:
        candidate=output/(name+'.py');candidate.write_text(body)
        runner="import sys; exec(compile(open(sys.argv[1]).read(),sys.argv[2],'exec'),{'__file__':sys.argv[2],'__name__':'__main__'})"
        result=subprocess.run([sys.executable,'-B','-c',runner,str(candidate),str(script)],capture_output=True,text=True,timeout=60,
                              env={**os.environ,'OPENPLAN_PROJECT_COPY_PROOF_OUTPUT':str(output/name)})
        if name=='retained-input-as-working':
            if result.returncode!=1 or 'Resolver did not select independent working copy' not in result.stderr:
                raise AssertionError('Native wrong-path control not detected: '+result.stderr)
        elif result.returncode:raise AssertionError(name+' failed: '+result.stderr)
        records.append({'control':name,'exit_code':result.returncode})
    report={'proof_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,
            'limits':'Native spatial project reopen through writer preparation and resolver; registration mocked. Wrong-path control stops before native reopen. No assignment or scientific acceptance.'}
    (ROOT/'native-project-working-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    (output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
