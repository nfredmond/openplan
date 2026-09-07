from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/owp-review-2026-09-07');app=root/'openplan';p=app/'src/app/api/knowledge-base/documents/[documentId]/download/route.ts';original=p.read_bytes();source=original.decode();results=[]
cases=[('json_array_encoding','JSON.stringify([{ id: document.id }])','[{ id: document.id }]',False),('harmless','    let reviewDocument','    // Harmless mutation of explanation.\n    let reviewDocument',True),('packet_detection','Boolean(document.work_program_packet_id)','false',False),('evidence_detection','Boolean(references.data?.length)','false',False),('lookup_failure','if (references.error)','if (false && references.error)',False),('packet_projection','checksum, work_program_packet_id")','checksum")',False)]
for name,old,new,passes in cases:
 assert old in source,name
 try:
  p.write_text(source.replace(old,new,1))
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/kb-document-download-route.test.ts'],cwd=app,text=True,capture_output=True)
  Path('/tmp/owp-document-mutation-'+name+'.log').write_text(r.stdout+r.stderr)
  results.append({'case':name,'expectedPass':passes,'exit':r.returncode,'passed':r.returncode==0})
  assert (r.returncode==0)==passes,(name,r.stdout+r.stderr)
 finally:p.write_bytes(original)
Path('/tmp/owp-document-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results))
