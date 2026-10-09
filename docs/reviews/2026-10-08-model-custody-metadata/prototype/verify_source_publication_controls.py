"""Fault controls for source-set ordering and the admitted publication command."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
source=ROOT/'workers/aequilibrae_worker/model_validation_source_publication.py'
writer=ROOT/'workers/aequilibrae_worker/model_attempt_writer.py'
original=source.read_text(); writer_original=writer.read_text()
variants=[('harmless',source,original+'\n# Harmless formatting control.\n')]
for name,before,after in [
 ('manifest-hash',' or hashlib.sha256(content).hexdigest() != digest',''),
 ('catalog-phase','    if rebuilt != manifest:', '    if False:'),
 ('omit-source-objects','for digest, record in sorted(objects.items()):','for digest, record in []:'),
]:
    assert original.count(before)==1,name
    variants.append((name,source,original.replace(before,after)))
start=original.index('        for digest, record in sorted(objects.items()):')
manifest=original.index('        uri = upload_file(',start)
end=original.index('        return {',manifest)
variants.append(('manifest-first',source,original[:start]+original[manifest:end]+original[start:manifest]+original[end:]))
start=writer_original.index('    def publish_validation_sources(')
end=writer_original.index('    def retain_package(',start)
section=writer_original[start:end]
for name,before,after in [
 ('writer-stop','            self.stopped = True','            self.stopped = False'),
 ('artifact-type',"'artifact_type': 'model_validation_source_publication'", "'artifact_type': 'wrong_publication'"),
 ('artifact-hash',"'content_hash': published['manifest_sha256']", "'content_hash': 'f' * 64"),
]:
    assert section.count(before)==1,name
    variants.append((name,writer,writer_original[:start]+section.replace(before,after)+writer_original[end:]))
variants.append(('restored',source,original))
cases=[]
try:
    for name,target,content in variants:
        source.write_text(original);writer.write_text(writer_original)
        target.write_text(content)
        result=subprocess.run([sys.executable,'-B','-m','unittest','test_model_validation_source_publication','test_model_validation_publication_writer'],cwd=ROOT/'workers/aequilibrae_worker',capture_output=True,text=True,timeout=30)
        detail=result.stdout+result.stderr
        if name in ('harmless','restored'):assert result.returncode==0,detail
        else:assert result.returncode!=0 and 'AssertionError' in detail,detail
        cases.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:source.write_text(original);writer.write_text(writer_original)
report={'source_sha256':hashlib.sha256(original.encode()).hexdigest(),'writer_sha256':hashlib.sha256(writer_original.encode()).hexdigest(),
        'cases':cases,'limits':'Actual publication/client/journal code with a synthetic TUS peer and injected database receipts. No joined native source-set publication, normal dispatch or scientific acceptance.'}
Path(__file__).with_name('source-publication-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
