"""Admission failures must prevent full execution; fixtures contain no model observations."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import admission as a
import execute as x
from types import SimpleNamespace


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name); self.e=root/'memory'; self.e.mkdir()
        self.r=root/'runtime'; self.r.mkdir(); self.old=root/'old'; self.old.mkdir()
        self.inputs=root/'input'; self.inputs.mkdir()
        freeze={}
        for folder in ['bundle','inputs-2000']:
            d=self.inputs/folder; d.mkdir(); (d/'data.csv').write_text('frozen\n')
            freeze[folder]={'data.csv':digest(d/'data.csv')}
        d=root/'choice-parity-evidence';d.mkdir();(d/'input-freeze.json').write_text(json.dumps({'inputs':freeze}))
        d=root/'chunk-cause-evidence';d.mkdir()
        cache=self.r/'training-2000/cache';cache.mkdir(parents=True);(cache/'chunk_cache.csv').write_text('sizes\n')
        (self.e/'parity-result.json').write_text(json.dumps({'status':'passed_choice_parity','cache_sha256':digest(cache/'chunk_cache.csv')}))
        for arm,ref in [('current','r2-2000-current-reference'),('semcog','r3-2000-semcog-reference')]:
            for out in [self.old/ref,self.r/('fit-2000-'+arm)]:
                out.mkdir();(out/'final_trips.csv').write_text('trip_id,depart\n1,2\n')
            h=digest(self.old/ref/'final_trips.csv')
            (d/(ref+'.run.json')).write_text(json.dumps({'final_files':{'final_trips.csv':h}}))
            (self.e/('fit-2000-'+arm+'.comparison.json')).write_text(json.dumps({'tables':[{'table':'final_trips.csv','candidate_sha256':h}]}))
        for obj,key,value in [(a,'E',self.e),(a,'OLD_R',self.old),(a.m,'R',self.r),(a.m,'INPUT',self.inputs),(a.m,'digest',digest)]:
            p=patch.object(obj,key,value);p.start();self.addCleanup(p.stop)
        self.compare=patch.object(a.m,'compare',return_value=True).start();self.addCleanup(patch.stopall)

    def test_intact_admission_and_harmless_metadata(self):
        (self.e/'note.txt').write_text('unrelated comment')
        self.assertEqual(a.admit_full(),self.r/'training-2000/cache/chunk_cache.csv')
        self.assertEqual(self.compare.call_count,2)

    def test_engine_failure_refused(self):
        cfg=self.r/'config';cfg.mkdir();(cfg/'settings.yaml').write_text('chunk_size: 0')
        output=self.r/'output';output.mkdir()
        with patch.object(x,'E',self.e), patch.object(a.m,'E',self.e), patch.object(x.subprocess,'run',return_value=SimpleNamespace(returncode=99)):
            with self.assertRaisesRegex(RuntimeError,'Stage failed'):
                x.run('fixture',cfg,self.inputs,output)
        receipt=json.loads((self.e/'fixture.run.json').read_text())
        self.assertEqual(receipt['exit_code'],99)

    def test_missing_cache_tag_refused(self):
        with self.assertRaisesRegex(RuntimeError,'Incomplete production cache'):
            a.verify_chunking('Running chunk 2 of 2\ninitial_row_size is zero')

    def test_changed_input_refused(self):
        (self.inputs/'bundle/data.csv').write_text('changed')
        with self.assertRaisesRegex(RuntimeError,'Input custody'): a.admit_full()
        self.compare.assert_not_called()

    def test_changed_reference_or_extra_table_refused(self):
        (self.old/'r2-2000-current-reference/final_extra.csv').write_text('extra')
        with self.assertRaisesRegex(RuntimeError,'final-file custody'): a.admit_full()

    def test_changed_cache_refused(self):
        (self.r/'training-2000/cache/chunk_cache.csv').write_text('changed')
        with self.assertRaisesRegex(RuntimeError,'parity/cache'): a.admit_full()

    def test_failed_proof_refused(self):
        path=self.e/'parity-result.json'
        result=json.loads(path.read_text());result['status']='failed'
        path.write_text(json.dumps(result))
        with self.assertRaisesRegex(RuntimeError,'parity/cache'): a.admit_full()

    def test_choice_difference_refused(self):
        self.compare.return_value=False
        with self.assertRaisesRegex(RuntimeError,'Choice parity'): a.admit_full()

    def test_changed_candidate_refused(self):
        (self.r/'fit-2000-semcog/final_trips.csv').write_text('changed')
        with self.assertRaisesRegex(RuntimeError,'final-file custody'): a.admit_full()


if __name__=='__main__':unittest.main()
