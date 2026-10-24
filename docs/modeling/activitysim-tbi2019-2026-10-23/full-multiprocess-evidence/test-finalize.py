"""Prove custody failures with temporary files, without touching retained outputs."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('custody',E/'finalize.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class Custody(unittest.TestCase):
    def execute(self,kind):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); evidence=root/'new'; evidence.mkdir(); run=root/'run'; run.mkdir()
            prior=root/'multiprocess-evidence'; prior.mkdir()
            engine=root/'engine'; engine.write_text('engine')
            frozen=root/'frozen'; frozen.write_text('frozen')
            (run/'artifact').write_text('artifact')
            (prior/'engine-preservation.json').write_text(json.dumps({'files':{str(engine):m.digest(engine) if kind!='engine' else 'wrong'}}))
            (root/'freeze.json').write_text(json.dumps({'files':[{'path':'frozen','sha256':m.digest(frozen) if kind!='frozen' else 'wrong'}]}))
            real=m.digest; calls=0
            def digest(path):
                nonlocal calls
                if path==run/'artifact':
                    calls+=1
                    if kind=='artifact' and calls>1: return 'changed'
                return real(path)
            with patch.multiple(m,E=evidence,REPO=root,R=run,FROZEN=root/'freeze.json'),patch.object(m,'digest',side_effect=digest),contextlib.redirect_stdout(io.StringIO()):
                m.main()
    def test_valid(self): self.execute('valid')
    def test_engine(self):
        with self.assertRaises(AssertionError): self.execute('engine')
    def test_frozen(self):
        with self.assertRaises(AssertionError): self.execute('frozen')
    def test_artifact(self):
        with self.assertRaises(AssertionError): self.execute('artifact')

if __name__=='__main__': unittest.main()
