"""Transit-specific byte custody controls over the existing package inventory."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'model_transit_inputs.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('ignore-feed-checksum',source.replace("feed.get('feed_checksum_sha256') != hashlib.sha256(raw).hexdigest()",'False'),'test_mismatched_archive_refused_before_retention'),
 ('ignore-inventory',source.replace("if set(entries) != {'feed.zip', 'transit.json'} or any(e['kind'] != 'file' for e in entries.values()):",'if False:'),'test_generic_package_is_not_accepted_as_transit'),
 ('ignore-read-hash',source.replace('len(raw) != size or hashlib.sha256(raw).hexdigest() != digest','len(raw) != size'),'test_same_size_metadata_change_after_copy_is_refused'),
 ('wrong-settings',source.replace("gtfs_skim.TransitSkimSettings.from_record(payload['skim_settings'])\n",'gtfs_skim.skim_settings()\n'),'test_original_bytes_metadata_and_settings_survive_independent_copy'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_transit_inputs',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_model_transit_inputs'+('.TransitInputTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real private files, existing package inventory and synthetic GTFS parse/skim. Caller authority remains required; no parent artifact registration, live provider acquisition, child dispatch, OS containment or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-input-controls.json').write_text(content);print(content)
