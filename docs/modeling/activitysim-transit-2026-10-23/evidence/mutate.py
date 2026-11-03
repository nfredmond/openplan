"""Isolated source mutations. Never edit the checkout under a running skim job."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[4]
MODULE=ROOT/'scripts/modeling/activitysim_transit_skims.py'
TESTS=ROOT/'scripts/modeling/tests'
source=MODULE.read_text()
# Each broken behavior runs one independently expected test. The harmless
# mutation runs all new tests, including the full default-bundle comparison.
CASES=[
 ('harmless_comment', '    require_runtime()\n    import numpy as np', '    # Mutation survivor: documentation only.\n    require_runtime()\n    import numpy as np', None, True),
 ('no_path_mislabeled', 'if has_paths else "unavailable"', 'if True else "unavailable"', 'test_no_reachable_departures_is_not_unknown_fare', False),
 ('ferry_labeled_light_rail', ' and not detail[1]:', ':', 'test_ferry_component_stays_separate_from_light_rail', False),
 ('ivt_halved','"TOTIVT": ivt/60','"TOTIVT": ivt/120','test_hand_computed_direct_transfer_wait_fare_and_periods',False),
 ('wait_erased','"IWAIT": first_wait/60','"IWAIT": 0.0','test_hand_computed_direct_transfer_wait_fare_and_periods',False),
 ('transfer_count_erased','"TRANSFERS": max(0,len(boards)-1)','"TRANSFERS": 0','test_hand_computed_direct_transfer_wait_fare_and_periods',False),
 ('mtc_scale_wrong','scale = 1 if component == "BOARDS" else 100','scale = 1','test_access_egress_and_mtc_units',False),
 ('access_erased','"WACC": 0.0 if drive_access else access_seconds/60','"WACC": 0.0','test_access_egress_and_mtc_units',False),
 ('missed_connection_allowed','k = bisect_left(ts, arr+duration)','k = bisect_left(ts, arr)','test_missed_transfer_is_not_a_possible_itinerary',False),
 ('forbidden_transfer_allowed','transfer_map[a].pop(b, None)','pass','test_forbidden_transfer',False),
 ('calendar_removal_ignored','active.discard(r["service_id"])','pass','test_calendar_removal_and_addition',False),
 ('calendar_addition_ignored','active.add(r["service_id"])','pass','test_calendar_removal_and_addition',False),
 ('hash_check_removed','if record["feed_sha256"] != config["feed_sha256"]:','if False:','test_missing_feed_hash_unmatched_stop_and_no_access_refuse',False),
 ('unknown_fare_free','        return None\n    fare = fares[0]','        return 0.0\n    fare = fares[0]','test_unknown_fare_is_not_free_or_enabled',False),
 ('drive_time_erased','"DTIM": (access_seconds if drive_access else egress if drive_egress else 0)/60','"DTIM": 0.0','test_explicit_drive_connectors_both_directions',False),
 ('primary_mode_not_required','(family == "TRN" or detail[0] == family)','True','test_primary_mode_required_with_local_feeder',False),
 ('dwell_classed_wait','edge(a, d, "ride", (mode, ferry))','edge(a, d, "wait")','test_onboard_dwell_does_not_add_boarding_or_wait',False),
 ('frequency_refusal_removed','if list(rows(z, "frequencies.txt")):','if False:','test_frequency_and_conditional_boarding_refused',False),
 ('pickup_ignored','r.get("pickup_type") != "1"','True','test_pickup_dropoff_restrictions_and_after_midnight',False),
 ('dropoff_ignored','r.get("drop_off_type") != "1"','True','test_pickup_dropoff_restrictions_and_after_midnight',False),
 ('transfer_walk_erased','xwalk += walk','xwalk += 0','test_cross_stop_transfer_walk_and_wait',False),
 ('fare_expiry_ignored','when-start > duration','False','test_zero_fare_is_measured_and_transfer_expiry_charges_again',False),
 ('fare_source_ignored','if not policy.get("source") or policy.get("kind") != "flat_per_boarding":','if policy.get("kind") != "flat_per_boarding":','test_sourced_fare_override_is_explicit',False),
 ('runtime_guard_removed','or sys.version_info[:2] != (3, 11)','or False','test_configuration_and_runtime_guards',False),
 ('skim_export_disabled','return np.where(mask,values*scale,0.0)','return np.zeros(shape)','test_opt_in_omx_and_custody',False),
]
runner='''import sys,types,unittest
from pathlib import Path
root=Path(sys.argv[1]);sys.path[:0]=[str(root/'scripts/modeling/tests'),str(root/'scripts/modeling')]
module=types.ModuleType('activitysim_transit_skims');module.__file__=str(root/'scripts/modeling/activitysim_transit_skims.py')
sys.modules[module.__name__]=module
exec(compile(Path(sys.argv[2]).read_text(),module.__file__,'exec'),module.__dict__)
name='test_activitysim_transit_skims'+('.TransitTests.'+sys.argv[3] if sys.argv[3] else '')
suite=unittest.defaultTestLoader.loadTestsFromName(name)
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
'''
records=[]
with tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/'mutated.py'
    for name,old,new,test,survive in CASES:
        if old not in source:raise RuntimeError('Mutation anchor missing: '+name)
        p.write_text(source.replace(old,new,1))
        run=subprocess.run([sys.executable,'-B','-c',runner,str(ROOT),str(p),test or ''],capture_output=True,text=True)
        # Reject setup/import errors as evidence of assertion sensitivity.
        valid=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in run.stderr and 'ERROR:' not in run.stderr
        records.append({'mutation':name,'expected':'survive' if survive else 'assertion_failure','verified':valid,'exit_code':run.returncode,'test':test,'output':run.stderr})
        print(name,valid,flush=True)
        if not valid:break
result={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'source_unchanged':MODULE.read_text()==source,'cases':records,'skipped':len(CASES)-len(records)}
Path(__file__).with_name('mutations.json').write_text(json.dumps(result,indent=2)+'\n')
sys.exit(not all(r['verified'] for r in records) or result['skipped']!=0)
