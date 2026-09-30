#!/usr/bin/env python3
"""Exercise input corruption only in an owned checkout with no acceptance run.

The module is restored in finally. Optional argument selects a private log directory.
"""
from pathlib import Path
import subprocess,json,hashlib,tempfile,sys
root=Path(__file__).resolve().parents[3]
app=root/'openplan'; file=app/'src/lib/engagement/synthesis-generation-input.ts'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='openplan-generation-input-proof-'));out.mkdir(parents=True,exist_ok=True)
original=file.read_text()
cases=[
 ('baseline',None,None,True),
 ('harmless-comment','// Split only transport frames, never the selected source inventory or its text.','// Preserve the selected source inventory while splitting transport frames.',True),
 ('clip-source','splitSource(source.snapshotText, limit)','splitSource(source.snapshotText.slice(0, 600), limit)',False),
 ('drop-comment-301','source.snapshot.items.map(row => `item:${row.id}`)','source.snapshot.items.slice(0, 300).map(row => `item:${row.id}`)',False),
 ('omit-survey-inventory','source.snapshot.answers.map(row => `answer:${row.id}`)','source.snapshot.answers.slice(0, 0).map(row => `answer:${row.id}`)',False),
 ('invent-neutral-assessment','"not_assessed"','"neutral"',False),
 ('erase-replies','replies: preparation.counts.replies','replies: 0',False),
 ('erase-unanswered-sessions','sessionsWithoutSelectedAnswers: preparation.counts.sessionsWithoutSelectedAnswers','sessionsWithoutSelectedAnswers: 0',False),
 ('round-and-reserialize-source','splitSource(source.snapshotText, limit)','splitSource(JSON.stringify(source.snapshot), limit)',False),
 ('count-code-units-as-bytes','Buffer.byteLength(character, "utf8")','character.length',False),
 ('split-surrogate-pairs','for (const character of text)','for (const character of text.split(""))',False),
 ('wrong-string-offset','end += character.length','end += 1',False),
 ('wrong-part-index','index: parts.length','index: 0',False),
 ('byte-gap','byteStart += bytes','byteStart += bytes + 1',False),
 ('wrong-part-digest','sha256: sha256(fragment)','sha256: sha256(fragment + "wrong")',False),
 ('wrong-manifest-digest','manifestSha256: sha256(manifestText)','manifestSha256: sha256(manifestText + "wrong")',False),
 ('wrong-source-digest','sha256: source.snapshotSha256, utf8Bytes','sha256: "0".repeat(64), utf8Bytes',False),
 ('accept-malformed-unicode','if (!text.isWellFormed()) throw new Error("Synthesis input has invalid Unicode");','// malformed Unicode guard removed for proof',False),
 ('accept-invalid-frame-limit','z.number().int().min(256).max(1_048_576)','z.number()',False),
 ('skip-authoritative-comparison','if (!isDeepStrictEqual(input, expected)) throw new Error("Synthesis input differs from the retained source");','// authority comparison removed for proof',False),
 ('skip-source-verification','const source = verifySynthesisSource(saved, scope);','const source = { ...saved, snapshot: JSON.parse(saved.snapshotText) };',False),
]
results=[]
try:
 for name,old,new,should_pass in cases:
  changed=original
  if old is not None:
   assert original.count(old)==(2 if name=='invent-neutral-assessment' else 1),(name,original.count(old));changed=original.replace(old,new)
  file.write_text(changed)
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-synthesis-generation-input.test.ts'],cwd=app,capture_output=True,text=True,timeout=90)
  log=run.stdout+run.stderr;(out/f'{name}.log').write_text(log)
  valid=(run.returncode==0)==should_pass
  if not should_pass:
   valid=valid and 'AssertionError' in log and 'FAIL' in log
  result={'case':name,'exit':run.returncode,'expected':'pass' if should_pass else 'assertion failure','valid':valid,'logSha256':hashlib.sha256(log.encode()).hexdigest()}
  results.append(result);print(json.dumps(result),flush=True)
  if not valid: raise RuntimeError('Unexpected mutation result '+name)
finally:
 file.write_text(original)
 (out/'results.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'cases':results,'restored':file.read_text()==original},indent=2)+'\n')
