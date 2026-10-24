"""Show that the archive tests detect removed refusal gates, without editing source."""
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
import test_package

P=Path(__file__).resolve().parent
source=(P/'verify_archive.py').read_text(); original=test_package.verifier
changes=[('comment survives',source+'\n# Harmless comment.\n',0),
 ('archive guard removed',source.replace("archive.stat().st_size != expected_bytes or digest(archive) != expected_sha256","False"),1),
 ('member hash guard removed',source.replace("h.hexdigest() != record['sha256']","False"),1),
 ('member size guard removed',source.replace("member.size != record['bytes']","False"),1),
 ('census guard removed',source.replace("seen != set(expected)","False"),1),
 ('duplicate guard removed',source.replace("or name in seen or name not in expected","or name not in expected"),1)]
results=[]
for name,code,must_fail in changes:
    module=types.ModuleType('mutated_verifier'); exec(compile(code,'<mutation>','exec'),module.__dict__)
    test_package.verifier=module
    result=unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(test_package.ArchiveTests))
    if result.errors or bool(result.failures)!=bool(must_fail):
        raise AssertionError((name,result.errors,result.failures))
    results.append({'mutation':name,'tests':result.testsRun,'assertion_failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped),'expected':True})
test_package.verifier=original
assert (P/'verify_archive.py').read_text()==source
print(json.dumps({'controls':results,'restoration':'source never changed','blind_category':'synthetic archive custody; no engine, S3 or scientific proof'},indent=2))
