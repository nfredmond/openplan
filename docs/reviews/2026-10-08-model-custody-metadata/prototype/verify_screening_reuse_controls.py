"""Detect destructive screening preparation while preserving source bytes."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'workers/activitysim_worker/supabase_poll.py';original=path.read_bytes()
anchor=b'    os.mkdir(screening_dir, mode=0o700)'
assert original.count(anchor)==1
fault=original.replace(anchor,b'    if os.path.exists(screening_dir):\n        shutil.rmtree(screening_dir)\n    os.mkdir(screening_dir, mode=0o700)')
results=[]
try:
    for name,body in (('harmless',original+b'\n# Harmless screening control.\n'),('erase-existing',fault),('restored',original)):
        path.write_bytes(body)
        run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_screening_materialization.py','-v'],cwd=ROOT,capture_output=True,text=True)
        if name=='erase-existing':
            assert run.returncode==1 and 'ERROR: test_existing_screening_evidence_is_preserved_before_input_access' in run.stderr and 'FileNotFoundError' in run.stderr,run.stderr
        else:assert run.returncode==0,run.stderr
        results.append({'case':name,'returncode':run.returncode,'expected_behavior_observed':True})
finally:path.write_bytes(original)
print(json.dumps({'cases':results,'source_sha256':hashlib.sha256(original).hexdigest(),'limits':['Synthetic filesystem reuse boundary; no native model or database execution']},indent=2))
