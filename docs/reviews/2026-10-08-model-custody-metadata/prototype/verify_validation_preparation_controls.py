"""Harmless and broken controls for explicit bundle file preparation."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_validation_preparation.py'
test=ROOT/'workers/aequilibrae_worker/test_model_validation_preparation.py'
original=source.read_text()
writer=ROOT/'workers/aequilibrae_worker/model_attempt_writer.py'
writer_original=writer.read_text()
variants={
 'harmless':original.replace("    manifest={'schema'","    entries.reverse()\n    manifest={'schema'"),
 'foreign-input':original.replace("if not path.is_relative_to(files.path):","if False:"),
 'reuse-directory':original.replace('os.mkdir(destination.name,mode=0o700,dir_fd=descriptor)','\n        if not destination.exists(): os.mkdir(destination.name,mode=0o700,dir_fd=descriptor)'),
 'skip-copy':original.replace("        model_handoff_files.copy_registered(files.root.parent,files.owner['run_id'],source,temporary,\n            sha256=record['sha256'],size_bytes=record['bytes'])","        temporary.write_bytes(source.read_bytes())"),
 'authorize-execution':original.replace("'execution_authorized':False","'execution_authorized':True"),
 'restored':original,
}
results=[]
try:
 for name,content in variants.items():
  assert name=='restored' or content!=original
  source.write_text(content)
  result=subprocess.run([sys.executable,'-B',str(test)],capture_output=True,text=True,timeout=30)
  if name in ('harmless','restored'):assert result.returncode==0,result.stderr
  else:assert result.returncode!=0 and 'AssertionError' in result.stderr,result.stderr
  results.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_text(original)
start=writer_original.index('    def prepare_validation_bundle(')
end=writer_original.index('    def publish_validation_sources(',start)
section=writer_original[start:end]
writer_variants={
 'writer-harmless':section.replace("'unassessed',", "'unassessed', "),
 'writer-no-registration':section.replace('            self.record_artifact({','            return retained\n            self.record_artifact({'),
 'writer-not-stopped':section.replace('            self.stopped = True','            self.stopped = False'),
 'writer-restored':section,
}
try:
 for name,content in writer_variants.items():
  writer.write_text(writer_original[:start]+content+writer_original[end:])
  result=subprocess.run([sys.executable,'-B',str(ROOT/'workers/aequilibrae_worker/test_model_validation_preparation_writer.py')],capture_output=True,text=True,timeout=30)
  if name in ('writer-harmless','writer-restored'):assert result.returncode==0,result.stderr
  else:assert result.returncode!=0 and 'AssertionError' in result.stderr,result.stderr
  results.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:writer.write_text(writer_original)
report={'writer_sha256':hashlib.sha256(writer.read_bytes()).hexdigest(),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'cases':results,
 'limits':'Real owned files and synthetic v2 records, including an empty observation package. No native preparation artifact command, stage integration, pre-result timing or scientific acceptance.'}
Path(__file__).with_name('validation-preparation-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
