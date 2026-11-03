"""Prove unchanged-default and bundle-caveat checks without editing the checkout."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[4]
CASES=[
 ('stock_scale_guard_removed','activitysim_mtc_inputs','if not constants.exists() or not re.search(', 'if False and re.search(', 'test_opt_in_refuses_incompatible_stock_scale'),
 ('default_version_drift','build_activitysim_input_bundle','CONFIG_STARTER_VERSION = "v0"','CONFIG_STARTER_VERSION = "changed"','test_default_bundle_bytes_match_prechange_source'),
 ('default_transit_enabled','activitysim_mtc_inputs','return "zero"  # transit, in every family and component','return "time"  # deliberate default fault','test_default_skim_bytes_match_prechange_source'),
 ('full_default_auto_drift','activitysim_mtc_inputs','INTRAZONAL_SPEED_MPH = 15.0','INTRAZONAL_SPEED_MPH = 30.0','test_default_full_mtc_bundle_matches_parent_bytes'),
 ('opt_in_caveat_dropped','build_activitysim_input_bundle','f"Opt-in GTFS transit status: {transit[\'status\']}. "','f"Every transit skim is zero. "','test_full_opt_in_bundle_records_custody_and_replaces_disabled_caveat'),
]
runner='''import sys,types,unittest
from pathlib import Path
root=Path(sys.argv[1]);sys.path[:0]=[str(root/'scripts/modeling/tests'),str(root/'scripts/modeling')]
m=types.ModuleType(sys.argv[2]);m.__file__=str(root/'scripts/modeling'/f'{sys.argv[2]}.py');sys.modules[m.__name__]=m
exec(compile(Path(sys.argv[3]).read_text(),m.__file__,'exec'),m.__dict__)
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName('test_activitysim_transit_skims.TransitTests.'+sys.argv[4]))
sys.exit(not r.wasSuccessful())
'''
results=[]
with tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/'mutant.py'
    for name,module,old,new,test in CASES:
        original=ROOT/'scripts/modeling'/f'{module}.py';source=original.read_text()
        if source.count(old)!=1:raise RuntimeError('ambiguous anchor '+name)
        p.write_text(source.replace(old,new))
        r=subprocess.run([sys.executable,'-B','-c',runner,str(ROOT),module,str(p),test],capture_output=True,text=True)
        valid=r.returncode!=0 and 'FAIL:' in r.stderr and 'ERROR:' not in r.stderr
        results.append({'mutation':name,'verified':valid,'test':test,'exit_code':r.returncode,'output':r.stderr,'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'source_unchanged':original.read_text()==source})
        print(name,valid)
        if not valid:break
Path(__file__).with_name('integration-mutations.json').write_text(json.dumps({'cases':results,'skipped':len(CASES)-len(results)},indent=2)+'\n')
sys.exit(not all(r['verified'] for r in results) or len(results)!=len(CASES))
