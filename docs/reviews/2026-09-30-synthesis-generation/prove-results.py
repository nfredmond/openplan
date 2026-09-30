#!/usr/bin/env python3
"""Run only in an owned checkout without concurrent checks or browser acceptance.

The implementation is restored in finally. Optional argument selects private logs.
"""
from pathlib import Path
import subprocess,json,hashlib,re,tempfile,sys
root=Path(__file__).resolve().parents[3]
app=root/'openplan';file=app/'src/lib/engagement/synthesis-generation-results.ts'
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path(tempfile.mkdtemp(prefix='openplan-generation-results-proof-'));out.mkdir(parents=True,exist_ok=True)
original=file.read_text()
cases=[
 ('baseline',None,None,True),
 ('harmless-comment','Older attempts remain separate history.','Earlier attempts remain separate retained history.',True),
 ('skip-attempt-binding','if (!isDeepStrictEqual(capture.binding, binding))','if (false)',False),
 ('skip-chronology','if (Date.parse(capture.finishedAt) < Date.parse(capture.startedAt))','if (false)',False),
 ('skip-contradictory-outcome','if (capture.outcome === "returned" && capture.failureCode !== null)','if (false)',False),
 ('normalize-original-output','JSON.stringify(capture);','JSON.stringify({...capture, outputText: capture.outputText?.trim() ?? null});',False),
 ('normalize-provider-receipt','JSON.stringify(capture);','JSON.stringify({...capture, providerReceiptText: capture.providerReceiptText?.trim() ?? null});',False),
 ('unknown-input-usage-as-zero','JSON.stringify(capture);','JSON.stringify({...capture, inputTokens: capture.inputTokens ?? 0});',False),
 ('unknown-output-usage-as-zero','JSON.stringify(capture);','JSON.stringify({...capture, outputTokens: capture.outputTokens ?? 0});',False),
 ('invalid-token-counts','z.number().int().nonnegative().safe().nullable()','z.number().nullable()',False),
 ('accept-unknown-schema','schemaVersion: z.literal(1)','schemaVersion: z.number()',False),
 ('accept-extra-capture-fields','failureCode: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).nullable(),\n}).strict();','failureCode: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).nullable(),\n});',False),
 ('skip-capture-integrity','if (!isDeepStrictEqual(result, verified))','if (false)',False),
 ('skip-source-plan-verification','verifySynthesisGenerationTasks(args.plan, args.records, args.input, args.saved, args.scope, args.taskByteLimit)','args.plan',False),
 ('skip-job-plan-binding','if (job.planSha256 !== plan.manifestSha256)','if (false)',False),
 ('allow-unknown-selected-task','!tasks.has(selection.taskSha256) || ','',False),
 ('allow-two-attempts-per-task','selected.has(selection.taskSha256) || ','',False),
 ('allow-shared-attempt-id',' || attemptIds.has(selection.attemptId)','',False),
 ('allow-empty-selection-dispatch','if (empty && selections.length)','if (false)',False),
 ('allow-duplicate-receipt',' || receipts.has(selection.taskSha256)','',False),
 ('discard-unselected-receipt','if (!selection || receipts.has(selection.taskSha256))','if (!selection) continue;\n    if (receipts.has(selection.taskSha256))',False),
 ('trust-receipt-selected-attempt','verifySynthesisGenerationResult({ ...job, ...selection }, result)','verifySynthesisGenerationResult(capture.binding, result)',False),
 ('cap-assembled-tasks','const entries = plan.tasks.map(task => {','const entries = plan.tasks.slice(0,300).map(task => {',False),
 ('conflate-unstarted-awaiting','selection ? "awaiting_result" : "not_started"','selection ? "not_started" : "awaiting_result"',False),
 ('treat-failed-return-as-success','if (capture.outcome !== "returned")','if (false)',False),
 ('skip-model-output-validation','parseSynthesisGenerationTaskOutput(task, JSON.parse(capture.outputText ?? ""))','({output:{status:"complete"}})',False),
 ('ignore-provider-finish','if (capture.finishReason !== "stop")','if (false)',False),
 ('promote-incomplete-model-output','parsed.output.status === "complete" ? "validated_output" : "incomplete_output"','"validated_output"',False),
 ('missing-receipt-gets-hash','receiptSha256: receipt?.sha256 ?? null','receiptSha256: receipt?.sha256 ?? "0".repeat(64)',False),
 ('any-task-makes-complete','entries.every(entry => entry.disposition === "validated_output")','entries.some(entry => entry.disposition === "validated_output")',False),
 ('drop-original-receipts','canonical: receipt.canonical, sha256: receipt.sha256','canonical: "{}", sha256: receipt.sha256',False),
 ('invent-assessed-interpretation','interpretation: "not_assessed" as const','interpretation: "assessed" as const',False),
 ('drop-contribution-membership','contributionIds: plan.contributionIds','contributionIds: []',False),
 ('wrong-inventory-digest','digest(JSON.stringify(manifest))','digest(JSON.stringify(manifest) + "wrong")',False),
 ('skip-result-inventory-verification','if (!isDeepStrictEqual(raw, expected))','if (false)',False),
]
results=[]
try:
 for name,old,new,should_pass in cases:
  changed=original
  if old is not None:
   assert original.count(old)==1,(name,original.count(old));changed=original.replace(old,new)
  file.write_text(changed)
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-synthesis-generation-results.test.ts'],cwd=app,capture_output=True,text=True,timeout=90)
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
