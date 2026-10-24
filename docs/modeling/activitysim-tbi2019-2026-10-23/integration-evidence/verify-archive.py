"""Read every archived file and check its declared bytes without extracting it."""
import copy,hashlib,json,tarfile
from pathlib import Path
EVIDENCE=Path(__file__).resolve().parent
custody=json.loads((EVIDENCE/'archive-custody.json').read_text())
manifest=(EVIDENCE/'archive-inventory.json').read_bytes()
expected={r['archive_path']:{'sha256':r['sha256'],'bytes':r['bytes']} for r in json.loads(manifest)['files']}
expected['archive-inventory.json']={'sha256':hashlib.sha256(manifest).hexdigest(),'bytes':len(manifest)}
actual={}
with tarfile.open(custody['archive_path'],'r|gz') as archive:
 for member in archive:
  if not member.isfile() or member.name in actual:raise AssertionError('Unexpected archive member')
  h=hashlib.sha256();size=0
  with archive.extractfile(member) as stream:
   for block in iter(lambda:stream.read(1024*1024),b''):h.update(block);size+=len(block)
  actual[member.name]={'sha256':h.hexdigest(),'bytes':size}
def verify(found,declared):
 if set(found)!=set(declared):raise AssertionError('Archive member set differs')
 for name in declared:
  if found[name]!=declared[name]:raise AssertionError('Archive member bytes differ: '+name)
verify(actual,expected)
verify(actual,dict(reversed(list(expected.items()))))
controls=[];key=next(k for k in expected if k!='archive-inventory.json')
for label in ['missing-member','wrong-hash','wrong-length','embedded-inventory']:
 fault=copy.deepcopy(actual)
 if label=='missing-member':fault.pop(key)
 elif label=='wrong-hash':fault[key]['sha256']='0'*64
 elif label=='wrong-length':fault[key]['bytes']+=1
 else:fault['archive-inventory.json']['sha256']='0'*64
 try:verify(fault,expected)
 except AssertionError:controls.append({'fault':label,'expected_failure':True})
 else:raise AssertionError('Fault survived: '+label)
verify(actual,expected)
if (EVIDENCE/'archive-inventory.json').read_bytes()!=manifest:raise AssertionError('Inventory changed during verification')
record={'archive_sha256':custody['sha256'],'inventory_sha256':hashlib.sha256(manifest).hexdigest(),
 'files_checked_including_embedded_inventory':len(actual),'all_member_bytes_match':True,
 'harmless_controls':1,'targeted_failures':controls,'source_inventory_unchanged':True,
 'control_boundary':'Wrong received member metadata after byte hashing; native controls do not authenticate producers',
 'modeled_or_survey_outputs_read':False}
(EVIDENCE/'archive-verification.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
