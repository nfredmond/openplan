from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import activitysim_walk_transfer as w
from activitysim_accepted_components import install_accepted_components

STOCK = Path(__file__).parent/'fixtures/activitysim_walk_transfer/stock'


def frames():
    ids = pd.Index([1,2,3,4], name='tour_id')
    b=pd.DataFrame({'WALK':[.2,.3,.4,.5], 'DRIVE':[.8,.7,.6,.5]},index=ids)
    c=pd.DataFrame({'WALK':[.1,.4,.3,.5], 'DRIVE':[.9,.6,.7,.5]},index=ids)
    strata=pd.DataFrame({'purpose':['work','school','shopping','social'],
                        'auto_class':['auto_sufficient','no_auto','auto_deficient','auto_sufficient'],
                        'category':['individual','individual','individual','joint']},index=ids)
    return b,c,strata


def result():
    b,c,s=frames()
    return {'schema_version':w.SCHEMA, 'decision':'inconclusive','development_disposition':'retire',
            'reason':'matched_observed_tour_modes_unavailable','observed_mode_log_loss':None,
            'observation_uncertainty':None,'coefficient_uncertainty':None,
            'checks':dict.fromkeys(['complete_coverage','probability_conservation','fixed_inputs',
                                    'joint_unchanged','baseline_replay_identical'],True),
            'strata':w.compare(b,c,b.copy(),s)}


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / "candidate"

    def test_default_is_noop_and_accepted_overlay_unchanged(self):
        with tempfile.TemporaryDirectory() as t:
            dest=Path(t)/'untouched'
            self.assertEqual(w.build_overlay(STOCK,dest), {'status':'default_unchanged','files':{}})
            self.assertFalse(dest.exists())
            d=Path(t)/'default'; d.mkdir()
            installed=install_accepted_components(d)
            self.assertEqual([x['component'] for x in installed],['auto_ownership'])
            self.assertEqual({p.name for p in d.iterdir()}, {'auto_ownership.yaml','auto_ownership.csv','auto_ownership_coefficients.csv'})
            registry=json.loads((w.ROOT/'data/modeling/activitysim-accepted-components.json').read_text())
            for name,sha in registry['components'][0]['overlay_files_sha256'].items():
                self.assertEqual(w.digest(d/name),sha)

    def test_transfer_exactly_27_and_preserves_other_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t)/'candidate'; before=w.digest(STOCK/'tour_mode_choice_coefficients.csv')
            package=w.build_overlay(STOCK,out,w.NAME)
            self.assertEqual(len(package['transfers']),27)
            a=(STOCK/'tour_mode_choice_coefficients.csv').read_bytes().splitlines(keepends=True)
            b=(out/'tour_mode_choice_coefficients.csv').read_bytes().splitlines(keepends=True)
            self.assertEqual(len(a),len(b))
            changed=[x.split(b',')[0].decode() for x,y in zip(a,b) if x!=y]
            self.assertEqual(set(changed),set(w.KEYS))
            coeff=w.read_coefficients(out/'tour_mode_choice_coefficients.csv')
            self.assertEqual(coeff['walk_ASC_auto_sufficient_work'],'-0.509785407')
            self.assertEqual(coeff['walk_ASC_auto_sufficient_atwork'],'0.677216')
            self.assertEqual(w.digest(STOCK/'tour_mode_choice_coefficients.csv'),before)
            self.assertEqual(package,json.loads((w.PACKAGE/'overlay/coefficient-set.json').read_text()))

    def test_unknown_name_refused(self):
        with self.assertRaisesRegex(ValueError,'unknown development'):
            w.build_overlay(STOCK,self.target,'accept-all')

    def test_source_tamper_refused(self):
        original=w.digest
        with patch.object(w,'digest',side_effect=lambda p:'0'*64 if p.name=='tour_mode_choice_coeffs.csv' else original(p)):
            with self.assertRaisesRegex(ValueError,'donor source hash'):
                w.build_overlay(STOCK,self.target,w.NAME)

    def test_stock_tamper_refused(self):
        original=w.digest
        with patch.object(w,'digest',side_effect=lambda p:'0'*64 if p==STOCK/'tour_mode_choice.csv' else original(p)):
            with self.assertRaisesRegex(ValueError,'stock source hash'):
                w.build_overlay(STOCK,self.target,w.NAME)

    def test_expression_and_template_mismatch(self):
        import shutil
        with tempfile.TemporaryDirectory() as t:
            s=Path(t)/'source'; shutil.copytree(w.PACKAGE/'source',s)
            spec=s/'tour_mode_choice.csv'; original=spec.read_text()
            spec.write_text(original.replace('df.auto_ownership == 0','df.auto_ownership == 1'))
            with self.assertRaisesRegex(ValueError,'incompatible WALK expression'):
                w.compatible_mapping(STOCK,s)
            spec.write_text(original)
            template=s/'tour_mode_choice_coeffs_template.csv'
            template.write_text(template.read_text().replace('walk_ASC_no_auto_work','walk_ASC_no_auto_school'))
            with self.assertRaisesRegex(ValueError,'incompatible purpose template'):
                w.compatible_mapping(STOCK,s)

    def test_duplicate_and_nonfinite_coefficients(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'c.csv'
            for text,reason in [('a,1\na,2\n','duplicate'),('a,nan\n','nonfinite')]:
                p.write_text('coefficient_name,value\n'+text)
                with self.assertRaisesRegex(ValueError,reason): w.read_coefficients(p)

    def test_probabilities_reject_each_bad_boundary(self):
        b,c,s=frames()
        for changed,reason in [(b.iloc[:-1],'coverage'),(pd.concat([b,b.iloc[:1]]),'coverage'),
                               (b*2,'invalid'),(b.assign(WALK=np.nan),'invalid'),
                               (b.assign(WALK=-.1),'invalid'),(b.rename(columns={'WALK':'OTHER'}),'WALK')]:
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(ValueError,reason): w.check_probabilities(changed,s.index)

    def test_replay_joint_and_census_guards(self):
        b,c,s=frames()
        with self.assertRaisesRegex(ValueError,'replay'): w.compare(b,c,c,s)
        with self.assertRaisesRegex(ValueError,'no probability effect'): w.compare(b,b.copy(),b.copy(),s)
        c.loc[4]=[.4,.6]
        with self.assertRaisesRegex(ValueError,'joint'): w.compare(b,c,b.copy(),s)
        b,c,s=frames(); s.loc[1,'purpose']='unknown'
        with self.assertRaisesRegex(ValueError,'strata census'): w.compare(b,c,b.copy(),s)

    def test_numeric_aggregation_uncertainty_empty_and_survivor(self):
        b,c,s=frames(); rows=w.compare(b,c,b.copy(),s)
        all_walk=rows[0]['modes']['WALK']
        self.assertAlmostEqual(all_walk['baseline']['expected_share'],.35)
        self.assertAlmostEqual(all_walk['candidate']['expected_share'],.325)
        self.assertAlmostEqual(all_walk['baseline']['conditional_choice_sd'],(0.16+0.21+0.24+0.25)**.5/4)
        self.assertEqual(rows, w.compare(b.iloc[::-1],c.iloc[::-1],b.copy(),s.iloc[::-1]))
        self.assertTrue(any(r['status']=='empty' and r['modes']['WALK']['baseline']['expected_share'] is None for r in rows))
        v=result(); w.validate(v)
        v['comment']='harmless metadata'; w.validate(v)

    def test_validator_refuses_false_advancement_and_evidence(self):
        for key, val, message in [('decision','accepted','advancement'),('development_disposition','advance','advancement'),
                                  ('observed_mode_log_loss',.1,'invented'),('observation_uncertainty',[0,1],'invented'),
                                  ('coefficient_uncertainty',[0,1],'invented')]:
            with self.subTest(key=key):
                v=result(); v[key]=val
                with self.assertRaisesRegex(ValueError,message): w.validate(v)

    def test_validator_checks_census_conservation_and_every_check(self):
        for key in result()['checks']:
            v=result(); v['checks'][key]=False
            with self.assertRaisesRegex(ValueError,'engineering'): w.validate(v)
        v=result(); v['strata'].pop()
        with self.assertRaisesRegex(ValueError,'missing strata'): w.validate(v)
        v=result(); v['strata'][0]['n']+=1
        with self.assertRaisesRegex(ValueError,'census'): w.validate(v)
        v=result(); v['strata'][0]['modes']['WALK']['candidate']['expected_share']=.9
        with self.assertRaisesRegex(ValueError,'probability'): w.validate(v)

    def test_missing_coefficient_and_census(self):
        original=w.read_coefficients
        def missing(p):
            values=original(p)
            if p.name=='tour_mode_choice_coeffs.csv': values.pop(w.KEYS[0])
            return values
        with patch.object(w,'read_coefficients',side_effect=missing):
            with self.assertRaisesRegex(ValueError,'missing walk'): w.build_overlay(STOCK,self.target,w.NAME)
        with patch.object(w,'KEYS',w.KEYS+(w.KEYS[0],)):
            with self.assertRaisesRegex(ValueError,'census'): w.build_overlay(STOCK,self.target,w.NAME)

    def test_native_boundary_checks(self):
        b,c,s=frames()
        w.check_fixed_inputs(b,b.copy(),b.copy())
        for pair in ((c,b),(b,c)):
            with self.assertRaisesRegex(ValueError,'held-fixed'): w.check_fixed_inputs(b,*pair)
        w.check_native_exit(0,'test')
        with self.assertRaisesRegex(RuntimeError,'native stage failed'): w.check_native_exit(7,'test')
        frozen=json.loads((w.PACKAGE/'overlay/coefficient-set.json').read_text())
        path=w.PACKAGE/'overlay/tour_mode_choice_coefficients.csv'
        w.check_frozen_candidate(frozen,copy.deepcopy(frozen),path)
        changed=copy.deepcopy(frozen); changed['name']='another'
        with self.assertRaisesRegex(ValueError,'frozen candidate'): w.check_frozen_candidate(changed,frozen,path)
        with patch.object(w,'digest',return_value='0'*64):
            with self.assertRaisesRegex(ValueError,'frozen candidate'): w.check_frozen_candidate(frozen,frozen,path)

    def test_environment_and_stock_directory(self):
        import prepare_activitysim_walk_transfer as prep
        import activitysim_mtc_inputs as mtc
        inventory=json.loads((w.ROOT/'docs/modeling/activitysim-coefficients-2026-10-23/stock-files.json').read_text())
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'env.json'; path.write_text('{"version":1}')
            with patch.object(prep,'environment_manifest',return_value={'version':1}), patch.object(mtc,'stock_configs_digest',return_value=inventory['stock_digest']):
                w.verify_environment(STOCK,path)
                path.write_text('{"version":2}')
                with self.assertRaisesRegex(ValueError,'environment changed'): w.verify_environment(STOCK,path)
                path.write_text('{"version":1}')
                with patch.object(mtc,'stock_configs_digest',return_value='0'*64):
                    with self.assertRaisesRegex(ValueError,'stock directory changed'): w.verify_environment(STOCK,path)

    def test_archive_member_allowlist(self):
        import zipfile
        from prepare_activitysim_walk_transfer import BUNDLE_FILES, zip_bundle, require_development_bundle
        require_development_bundle(Path('/synthetic/runs/dev/example/activitysim_bundle'))
        for bad in ('/synthetic/runs/holdout/example/activitysim_bundle', '/synthetic/runs/dev/example/output'):
            with self.assertRaisesRegex(ValueError,'development input partition'): require_development_bundle(Path(bad))
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); archive=root/'input.zip'
            with zipfile.ZipFile(archive,'w') as z:
                for name in BUNDLE_FILES: z.writestr(name,'synthetic')
            w.extract_bundle(archive,root/'out')
            with zipfile.ZipFile(archive,'a') as z: z.writestr('../outside','no')
            with self.assertRaisesRegex(ValueError,'unexpected archive'): w.extract_bundle(archive,root/'bad')
            self.assertFalse((root/'outside').exists())
            with self.assertRaisesRegex(ValueError,'already exists'): zip_bundle(root/'out',archive)

if __name__=='__main__': unittest.main()
