#!/usr/bin/env python3
"""Probe record preservation only in an owned checkout with no acceptance run.

The module is restored in finally. Optional argument selects a private log directory.
"""
from pathlib import Path
import subprocess,json,hashlib,re,tempfile,sys
root=Path(__file__).resolve().parents[3]
app=root/'openplan';file=app/'src/lib/engagement/synthesis-generation-records.ts'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='openplan-generation-records-proof-'));out.mkdir(parents=True,exist_ok=True)
original=file.read_text()
cases=[
 ('baseline',None,None,True),
 ('harmless-comment','// Bind references and ordered membership as well as each complete record.','// Include complete records, references and ordered membership in the binding.',True),
 ('cap-records-at-300','array(snapshot[collection])','array(snapshot[collection]).slice(0, 300)',False),
 ('omit-survey-records',', ["answers", "answer"]','',False),
 ('omit-definition-records','array(snapshot.definitions)','array(snapshot.definitions).slice(0, 0)',False),
 ('round-numeric-tokens','new RetainedNumber(token)','new RetainedNumber(String(value))',False),
 ('invent-neutral','interpretation: "not_assessed" as const','interpretation: "neutral" as const',False),
 ('clip-long-strings','return JSON.stringify(value);','return JSON.stringify(typeof value === "string" ? value.slice(0,600) : value);',False),
 ('omit-context-counts','!collections.has(key)','!collections.has(key) && key !== "counts"',False),
 ('duplicate-source-in-context','!collections.has(key)','true',False),
 ('drop-parent-reference','if (kind === "item" && row.parent_item_id !== null)','if (false)',False),
 ('claim-missing-reference-retained','retainedIds.has(reference.id)','true',False),
 ('drop-definition-reference','if (row.configuration_version_id !== null && row.configuration_version_id !== undefined)','if (false)',False),
 ('collapse-source-kind','`${kind}:${string(row.id)}`','`item:${string(row.id)}`',False),
 ('wrong-record-digest','sha256: sha256(text)','sha256: sha256(text + "wrong")',False),
 ('wrong-record-byte-count','utf8Bytes: Buffer.byteLength(text, "utf8")','utf8Bytes: text.length',False),
 ('wrong-manifest-digest','sha256(JSON.stringify(manifest))','sha256(JSON.stringify(manifest) + "wrong")',False),
 ('unbound-references','records.map(({ text: _text, ...descriptor }) => descriptor)','records.map(({ text: _text, references: _references, ...descriptor }) => descriptor)',False),
 ('skip-authoritative-record-check','if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis records differ from the retained input");','// authoritative record check omitted',False),
 ('skip-input-verification','const verified = verifySynthesisGenerationInput(input, saved, scope);','const verified = { manifest: JSON.parse(input.manifestText), manifestSha256: input.manifestSha256, snapshotText: input.parts.map(part => part.text).join("") };',False),
 ('round-on-missing-numeric-source','const token = context?.source;','const token = context?.source ?? String(value);',False),
 ('participant-object-as-numeric','if (value instanceof RetainedNumber) return value.token;','if (value instanceof RetainedNumber || value && typeof value === "object" && "token" in value) return value.token;',False),
]
results=[]
try:
 for name,old,new,should_pass in cases:
  changed=original
  if old is not None:
   assert original.count(old)==1,(name,original.count(old));changed=original.replace(old,new)
  file.write_text(changed)
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-synthesis-generation-records.test.ts'],cwd=app,capture_output=True,text=True,timeout=90)
  log=run.stdout+run.stderr;(out/f'{name}.log').write_text(log)
  plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',log)
  failures=[line.strip() for line in plain.splitlines() if line.strip().startswith('FAIL ') and ' > ' in line]
  valid=(run.returncode==0)==should_pass and (should_pass or bool(failures))
  result={'case':name,'exit':run.returncode,'expected':'pass' if should_pass else 'named test failure','valid':valid,'firstFailure':failures[0] if failures else None,'logSha256':hashlib.sha256(log.encode()).hexdigest()}
  results.append(result);print(json.dumps(result),flush=True)
  if not valid:raise RuntimeError('Unexpected mutation result '+name)
finally:
 file.write_text(original)
 (out/'results.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'cases':results,'restored':file.read_text()==original},indent=2)+'\n')
