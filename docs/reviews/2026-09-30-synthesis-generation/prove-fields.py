#!/usr/bin/env python3
"""Probe typed fields only in an owned checkout without concurrent checks.

The module is restored in finally. Optional argument selects private logs.
"""
from pathlib import Path
import subprocess,json,hashlib,re,tempfile,sys
root=Path(__file__).resolve().parents[3]
app=root/'openplan';file=app/'src/lib/engagement/synthesis-generation-records.ts'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='openplan-generation-fields-proof-'));out.mkdir(parents=True,exist_ok=True)
original=file.read_text()
cases=[
 ('baseline',None,None,True),
 ('harmless-comment','/** A field inventory must still account for the entire authoritative record set. */','/** Keep the field inventory tied to every authoritative record. */',True),
 ('cap-field-records','const records = verified.records.map(record => {','const records = verified.records.slice(0,300).map(record => {',False),
 ('skip-record-verification','const verified = verifySynthesisGenerationRecords(rawRecords, input, saved, scope);','const verified = rawRecords;',False),
 ('round-numeric-field','kind: "number", text: value.token','kind: "number", text: String(Number(value.token))',False),
 ('escape-literal-field-text','kind: "string", text: value','kind: "string", text: JSON.stringify(value)',False),
 ('mislabel-null-text','kind: "null", text: "null"','kind: "null", text: "missing"',False),
 ('false-for-all-booleans','text: value ? "true" : "false"','text: "false"',False),
 ('boolean-as-string','kind: "boolean", text: value ? "true" : "false"','kind: "string", text: value ? "true" : "false"',False),
 ('drop-empty-strings','else if (typeof value === "string") fields.push({ pointer, kind: "string", text: value });','else if (typeof value === "string") { if (value.length) fields.push({ pointer, kind: "string", text: value }); }',False),
 ('false-array-count','kind: "array", childCount: value.length','kind: "array", childCount: 0',False),
 ('drop-array-tail','value.forEach((child, index)','value.slice(0,-1).forEach((child, index)',False),
 ('false-object-count','kind: "object", childCount: entries.length','kind: "object", childCount: 0',False),
 ('drop-object-tail','for (const [key, child] of entries)','for (const [key, child] of entries.slice(0,-1))',False),
 ('ambiguous-pointer',r'key.replace(/~/g, "~0").replace(/\//g, "~1")','key',False),
 ('wrong-record-binding','recordSha256: record.sha256, fields','recordSha256: "0".repeat(64), fields',False),
 ('wrong-fields-digest','fieldsSha256: sha256(JSON.stringify(value))','fieldsSha256: sha256(JSON.stringify(value) + "wrong")',False),
 ('wrong-parent-manifest','recordsManifestSha256: verified.manifestSha256, records','recordsManifestSha256: "0".repeat(64), records',False),
 ('wrong-schema-version','return { schemaVersion: 1, recordsManifestSha256','return { schemaVersion: 2, recordsManifestSha256',False),
 ('skip-field-inventory-check','if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis fields differ from the retained records");','// field inventory check omitted',False),
]
results=[]
try:
 for name,old,new,should_pass in cases:
  changed=original
  if old is not None:
   assert original.count(old)==1,(name,original.count(old));changed=original.replace(old,new)
  file.write_text(changed)
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-synthesis-generation-fields.test.ts'],cwd=app,capture_output=True,text=True,timeout=90)
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
