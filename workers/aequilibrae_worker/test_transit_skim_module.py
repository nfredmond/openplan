"""Fresh-process import and numerical skim without credentialed worker imports."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import model_transit_skim as transit
import test_prepared_feed_skim as prepared
import test_transit_feed_handoff as fixtures


class TransitModuleTests(unittest.TestCase):
    def test_fresh_process_skims_without_worker_or_transport_import(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            feed=root/'feed.zip';feed.write_bytes(fixtures._feed_bytes())
            _,meta=prepared.PreparedFeedTests().prepare()
            metadata=root/'meta.json';metadata.write_text(json.dumps(meta))
            code='''
import builtins,importlib.util,json,sys
from pathlib import Path
original=builtins.__import__
def guarded(name,*args,**kwargs):
 if name.split('.')[0] in ('main','dotenv','requests'):
  raise AssertionError('Forbidden worker or transport import: '+name)
 return original(name,*args,**kwargs)
builtins.__import__=guarded
def audit(event,args):
 if event=='socket.connect':raise AssertionError('Unexpected network connection')
sys.addaudithook(audit)
spec=importlib.util.spec_from_file_location('model_transit_skim',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
import numpy as np
los=module.gtfs_skim.load_feed(raw=Path(sys.argv[2]).read_bytes(),source_name='Test Transit')
meta,skim,log=module.skim_prepared_feed_version(los,json.loads(Path(sys.argv[3]).read_text()),np.array([-121.050,-121.070]),np.array([39.200,39.220]))
assert not {'main','dotenv','requests'}.intersection(sys.modules)
print(json.dumps({'available':bool(skim['available'][0,1]),'version':meta['feed_version_id'],'checksum':meta['feed_checksum_sha256']}))
'''
            result=subprocess.run([sys.executable,'-B','-c',code,transit.__file__,str(feed),str(metadata)],
                cwd=directory,env={'PATH':os.environ.get('PATH','/usr/bin'),'PYTHONPATH':str(Path(__file__).parent),
                                  'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},
                capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout),{'available':True,'version':meta['feed_version_id'],'checksum':meta['feed_checksum_sha256']})

    def test_worker_exports_the_shared_numerical_implementation(self):
        self.assertIs(fixtures.main.skim_prepared_feed_version,transit.skim_prepared_feed_version)
        self.assertIs(fixtures.main._transit_feed_summary,transit._transit_feed_summary)
        self.assertIs(fixtures.main._feed_expiry_log_note,transit._feed_expiry_log_note)


if __name__=='__main__':unittest.main()
