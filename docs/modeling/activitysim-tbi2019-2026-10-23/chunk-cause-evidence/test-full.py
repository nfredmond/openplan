import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('full',E/'run-full.py');full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)
spec=importlib.util.spec_from_file_location('health',E/'modeled-health.py');health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)


class FullTests(unittest.TestCase):
    def admission(self, broken=None):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); cache=root/'cache';cache.write_text('frozen')
            (root/'hybrid-result.json').write_text(json.dumps({'status':'failed' if broken=='status' else 'passed_choice_parity','full_runs_authorized':True}))
            (root/'hybrid-before-run.json').write_text(json.dumps({'cache_origin':str(cache),'cache_sha256':full.m.digest(cache)}))
            if broken=='cache':cache.write_text('changed')
            with patch.multiple(full.m,E=root,R=root),patch.object(full.m,'compare',return_value=broken!='comparison') as compare:
                if broken:
                    with self.assertRaises(RuntimeError):full.admit_full()
                    self.assertEqual(compare.call_count,1 if broken=='comparison' else 0)
                else:
                    self.assertEqual(full.admit_full(),cache);self.assertEqual(compare.call_count,4)
    def test_unfinished_proof_refuses(self):self.admission('status')
    def test_cache_change_refuses(self):self.admission('cache')
    def test_changed_final_choices_refuse(self):self.admission('comparison')
    def test_complete_proof_checks_all_four(self):self.admission()
    def test_full_input_hash_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);e=root/'evidence';e.mkdir();(root/'choice-parity-evidence').mkdir()
            (root/'choice-parity-evidence/input-freeze.json').write_text(json.dumps({'inputs':{'bundle':{'households.csv':'wrong hash'}}}))
            (root/'bundle').mkdir();(root/'bundle/households.csv').write_text('input')
            (root/'bundle/configs').mkdir();(root/'bundle/configs/settings.yaml').write_text('models: []')
            with patch.multiple(full.m,E=e,INPUT=root),patch.object(full,'admit_full',return_value=root/'cache'),patch.object(full.m,'config') as config,patch.object(full.m.yaml,'safe_load',side_effect=AssertionError('continued after changed input')):
                with self.assertRaisesRegex(RuntimeError,'Frozen input hash mismatch'):full.main()
                config.assert_not_called()
    def test_streamed_health_joins_and_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            files={
                'land_use':'zone_id,county_id\n1,A\n2,B\n',
                'households':'household_id,home_zone_id,auto_ownership\n10,1,0\n20,2,2\n',
                'persons':'person_id,is_university\n100,True\n200,False\n',
                'tours':'tour_id,household_id,person_id,tour_type,tour_category,tour_mode\n1,10,100,work,mandatory,WALK\n2,10,100,univ,mandatory,WALK\n3,20,200,shopping,non_mandatory,DRIVEALONEFREE\n',
                'trips':'tour_id,trip_mode,outbound,trip_num,depart\n1,WALK,True,1,5\n1,WALK,False,1,9\n2,WALK,True,1,9\n3,DRIVEALONEFREE,True,1,18\n',
            }
            for name,data in files.items():(root/('final_'+name+'.csv')).write_text(data)
            r=health.summarize(root,{'periods':[0,3,5,9,14,18,24],'labels':['EA','EA','AM','MD','PM','EV']})
            self.assertEqual((r['tour_count'],r['trip_count']),(3,4))
            self.assertEqual(r['domains_MODELED']['home_county']['A']['tours'],2)
            self.assertEqual(r['domains_MODELED']['home_county']['B']['mode_shares'],{'DRIVEALONEFREE':1.0})
            self.assertEqual(set(r['domains_MODELED']['first_departure_period']),{'EA','AM','PM'})
            self.assertEqual(r['domains_MODELED']['vehicles']['zero']['tours'],2)

    def test_period_boundaries_and_missing(self):
        settings=([0,3,5,9,14,18,24],['EA','EA','AM','MD','PM','EV'])
        self.assertEqual([health.period_label(x,*settings) for x in [None,0,3,5,9,14,18,24,25]],['__unavailable__','__unavailable__','EA','EA','AM','MD','PM','EV','__unavailable__'])
    def test_shares_keep_group_denominator(self):
        a=health.share_record({'WALK':2,'DRIVEALONEFREE':1});b=health.share_record({'WALK':2})
        self.assertEqual(a['tours'],3);self.assertEqual(a['mode_shares']['WALK'],2/3)
        self.assertEqual(b['mode_shares']['WALK'],1.0);self.assertIsNone(health.share_record({})['mode_shares'])


if __name__=='__main__':unittest.main()
