#!/usr/bin/env python3
"""Run only in an owned checkout without concurrent checks or browser acceptance.

The implementation is restored in finally. Optional argument selects private logs.
"""
from pathlib import Path
import subprocess,json,hashlib,re,tempfile,sys
root=Path(__file__).resolve().parents[3]
app=root/'openplan';file=app/'src/lib/engagement/synthesis-generation-tasks.ts'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='openplan-generation-tasks-proof-'));out.mkdir(parents=True,exist_ok=True)
original=file.read_text()
cases=[
 ('baseline',None,None,True),
 ('harmless-comment','No dispatch, interpretation, review acceptance or authorization is established here.','This function does not dispatch, interpret, accept or authorize a review.',True),
 ('ignore-resource-bounds','const limit = limitSchema.parse(taskByteLimit);','const limit = taskByteLimit;',False),
 ('ignore-workspace-scope','createSynthesisGenerationFields(rawRecords, input, saved, scope)','createSynthesisGenerationFields(rawRecords, input, saved, {...scope, workspaceId: rawRecords.source.workspaceId})',False),
 ('cap-records','records.records.entries()','records.records.slice(0,300).entries()',False),
 ('false-record-kind','recordKind: record.kind','recordKind: "context"',False),
 ('false-record-digest','recordSha256: record.sha256','recordSha256: "0".repeat(64)',False),
 ('claim-absent-reference-content','includedInTask: false as const','includedInTask: true as const',False),
 ('false-field-digest','digest(JSON.stringify(field))','digest("wrong")',False),
 ('drop-container-count','{ childCount: field.childCount }','{ childCount: 0 }',False),
 ('clip-fragment','text: field.text.slice(start, end)','text: field.text.slice(start, Math.min(end,start+600))',False),
 ('wrong-range-unit','rangeUnit: "utf16_code_units" as const','rangeUnit: "utf8_bytes" as const',False),
 ('omit-surrogate-adjustment-survivor','? end - 1 : end','? end : end',True),
 ('force-surrogate-split','pending.push(fragment(best)); start = best;', 'const pair = field.text.indexOf("😀",start); if (pair >= start && pair + 1 < best) best = pair + 1; pending.push(fragment(best)); start = best;',False),
 ('unbound-part-ranges','recordId: record.id, ...data','recordId: record.id, fieldIndex',False),
 ('claim-whole-fragment','recordComplete: batches.length === 1','recordComplete: true',False),
 ('wrong-task-bytes','utf8Bytes: Buffer.byteLength(text, "utf8")','utf8Bytes: text.length',False),
 ('wrong-task-digest','sha256: digest(text)','sha256: digest(text + "wrong")',False),
 ('wrong-plan-digest','digest(JSON.stringify(manifest))','digest(JSON.stringify(manifest) + "wrong")',False),
 ('ignore-task-byte-fit','canonical({ ...base, parts: [...pending, part] }), "utf8") <= limit','canonical({ ...base, parts: [...pending, part] }), "utf8") <= limit * 2',False),
 ('ignore-expected-limit','saved, scope, taskByteLimit);\n  if (!isDeepStrictEqual','saved, scope, raw.taskByteLimit);\n  if (!isDeepStrictEqual',False),
 ('skip-task-authority','if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis tasks differ from the retained source");','// authority check omitted',False),
 ('skip-output-task-digest','digest(task.canonical) !== task.sha256 || ','',False),
 ('skip-output-task-bytes',' || Buffer.byteLength(task.canonical, "utf8") !== task.utf8Bytes','',False),
 ('allow-duplicate-coverage','covered.size !== output.coveredPartIds.length || ','',False),
 ('allow-unknown-coverage','[...covered].some(id => !parts.has(id)) ||','false ||',False),
 ('allow-incomplete-coverage','output.status === "complete" && covered.size !== parts.size','false',False),
 ('allow-uncovered-citation','!covered.has(citation.partId) || ','',False),
 ('allow-container-citation','!("text" in part) || !part.text.includes(citation.quote)','"text" in part && !part.text.includes(citation.quote)',False),
 ('allow-invented-quote','!part.text.includes(citation.quote)','false',False),
 ('allow-extra-output','}).strict();','});',False),
]
results=[]
try:
 for name,old,new,should_pass in cases:
  changed=original
  if old is not None:
   assert original.count(old)==1,(name,original.count(old));changed=original.replace(old,new)
  file.write_text(changed)
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-synthesis-generation-tasks.test.ts'],cwd=app,capture_output=True,text=True,timeout=90)
  log=run.stdout+run.stderr;(out/f'{name}.log').write_text(log)
  plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',log)
  failures=[line.strip() for line in plain.splitlines() if line.strip().startswith('FAIL ') and ' > ' in line]
  valid=(run.returncode==0)==should_pass and (should_pass or bool(failures))
  result={'case':name,'exit':run.returncode,'expected':'observed survivor, not a fault kill' if name=='omit-surrogate-adjustment-survivor' else ('pass' if should_pass else 'named test failure'),'valid':valid,'firstFailure':failures[0] if failures else None,'logSha256':hashlib.sha256(log.encode()).hexdigest()}
  results.append(result);print(json.dumps(result),flush=True)
  if not valid:raise RuntimeError('Unexpected mutation result '+name)
finally:
 file.write_text(original)
 (out/'results.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'cases':results,'restored':file.read_text()==original},indent=2)+'\n')
