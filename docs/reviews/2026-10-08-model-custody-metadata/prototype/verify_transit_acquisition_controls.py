"""Archive acquisition origin and parser forwarding fault controls."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'gtfs_skim.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('lose-supplied-identity',source.replace('return raw, source_url, source_name','return raw, None, None'),'test_supplied_bytes_ignore_operator_urls_and_paths'),
 ('wrong-cache-key',source.replace('hashlib.md5(url.encode("utf-8")).hexdigest()[:16]',"'wrong-cache-key'"),'test_downloaded_bytes_are_the_exact_cached_archive'),
 ('expose-local-path',source.replace('return raw, None, os.path.basename(path)','return raw, None, path'),'test_operator_path_and_bundled_default_keep_local_identity'),
 ('ignore-url',source.replace('    elif url:\n        import requests', '    elif False:\n        import requests'),'test_existing_url_precedence_over_path_is_preserved'),
 ('lose-parser-identity',source.replace('    los.source_name = source_name','    los.source_name = None'),'test_loader_parses_exact_acquisition_result_without_second_read'),
 ('restored',source,'')]
runner='''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('gtfs_skim',sys.argv[1])
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
name='test_transit_archive_acquisition'+('.ArchiveAcquisitionTests.'+sys.argv[2] if sys.argv[2] else '')
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
report={'gtfs_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Real local/cache files and synthetic feed, mocked download transport. Existing precedence/cache behavior preserved, not live provider or acquisition deadline/containment proof. Non-selected-origin parent retention and channel integration remain open.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'transit-acquisition-controls.json').write_text(content);print(content)
