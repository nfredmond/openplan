"""Show preparation custody tests reject overwrites and survive a harmless edit."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'scripts/modeling/prepare_development_validation_instruments.py'
test=ROOT/'scripts/modeling/tests/test_preparation_no_overwrite.py'
original=source.read_text()
variants={
    'harmless':original.replace('length=1024 * 1024','length=512 * 1024'),
    'overwrite-network':original.replace('raise instrument.InstrumentError(f"Existing preparation source differs: {target}")','shutil.copyfile(source, target); return'),
    'reuse-output':original.replace('output_root.mkdir(parents=True, exist_ok=False)','output_root.mkdir(parents=True, exist_ok=True)'),
    'follow-dangling-target':original.replace('target.open("xb")','target.open("wb")'),
    'restored':original,
}
cases=[]
try:
    for name,content in variants.items():
        assert name=='restored' or content!=original
        source.write_text(content)
        result=subprocess.run([sys.executable,'-B',str(test)],capture_output=True,text=True,timeout=30)
        if name in ('harmless','restored'):
            assert result.returncode==0,result.stderr
        else:
            assert result.returncode!=0 and 'AssertionError' in result.stderr,result.stderr
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
    source.write_text(original)
report={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'cases':cases,
        'limits':'Real temporary files and mocked source acquisition. Does not establish independent scientific preparation, full filesystem race resistance or crash recovery.'}
Path(__file__).with_name('preparation-no-overwrite-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
