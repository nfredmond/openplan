"""Prove private submission handoff and fair recovery assertions can fail."""
from pathlib import Path
import hashlib,json,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];path=root/'openplan/src/lib/gtfs/managed-submission-recovery.ts';original=path.read_text();out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
def change(before,after,count=1):
 assert original.count(before)==count,before
 return original.replace(before,after)
variants=[('baseline',original,None),('harmless',original+'\n// Harmless private recovery control.\n',None),
 ('harmless-relative-check',change('isAbsolute(options.directory)','true'),None),
 ('directory-normalization',change('  const lock = await acquireConnectorLock(options.directory),','  options.directory = await import("node:path").then(p => p.resolve(options.directory));\n  const lock = await acquireConnectorLock(options.directory),').replace('isAbsolute(options.directory)','true'),'relative directories'),
 ('authorization',change('await options.authorize(saved, signal);','// Skip original authority.'),'original authorization is unavailable'),
 ('actor',change('actorId: saved.binding.actorId','actorId: saved.binding.workspaceId'),'authorizes the original actor'),
 ('workspace',change('workspaceId: saved.binding.workspaceId','workspaceId: saved.binding.actorId'),'authorizes the original actor'),
 ('intent',change('intent: saved.binding.intent','intent: {}'),'authorizes the original actor'),
 ('skip-history',change('          continue;\n        }','          // Replay handed-off history.\n        }'),'skips proven handoff history'),
 ('handoff-binding',change('isDeepStrictEqual(marker, { binding: saved.binding, resolved: saved.resolved, response: saved.response })','true'),'mismatched existing handoff'),
 ('root-binding',change('root.target === binding.target && root.installationId === binding.installationId','true'),'installation rebinding'),
 ('request-binding',change('saved.binding.requestId === requestId && saved.binding.target === binding.target && saved.binding.installationId === binding.installationId','true'),'retained installationId scope'),
 ('directory-private',change('info.uid === process.getuid?.() && (info.mode & 0o077) === 0','true'),'public request directory'),
 ('harmless-directory-redundancy',change('info.isDirectory() && !info.isSymbolicLink()','true'),None),
 ('directory-symlink',change('info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0','true'),'request symlinks'),
 ('inventory',change('entries.length <= maxRecords + 2','true'),'oversized inventory'),
 ('bound',change('z.number().int().min(1).max(100).parse(options.maxJobs ?? 10)','options.maxJobs ?? 10'),'invalid per-pass limit'),
 ('pass-cap',change('if (outcomes.length >= maxJobs)','if (false)'),'rotates persistent refusals'),
 ('cursor',change('root.cursor = requestId;','root.cursor = null;'),'rotates persistent refusals'),
 ('archive-confirmation',change('result.status.state !== "awaiting_archive"','true'),'archive that remains unconfirmed'),
 ('reply-scope',change('result.registration.requestId === requestId && result.status.requestId === requestId && result.status.workspaceId === saved.binding.workspaceId\n          && result.status.versionId === result.registration.versionId && result.status.feedId === result.registration.feedId','true'),'response with changed'),
 ('local-receipt',change('isDeepStrictEqual(updated.response, result.registration)','true'),'saved receipt does not match'),
 ('local-binding',change('isDeepStrictEqual(updated.binding, saved.binding)','true'),'saved actor changes'),
 ('marker-write',change('await writeConnectorJournal(markerPath, { binding: updated.binding, resolved: updated.resolved, response: updated.response });','// Omit durable handoff.'),'authorizes the original actor'),
 ('pre-cancel',change('options.signal.throwIfAborted();','// Ignore early cancellation.'),'pre-cancelled request'),
 ('authorization-cancel',change('await options.authorize(saved, signal); signal.throwIfAborted();','await options.authorize(saved, signal);'),'authorization loses ownership'),
 ('installation-lock',change('const lock = await acquireConnectorLock(options.directory), ending = new AbortController();','await privateConnectorDirectory(options.directory); const lock = { signal: new AbortController().signal, release: async () => {} }, ending = new AbortController();'),'serializes concurrent recovery'),
 ('restored',original,None)]
records=[]
try:
 for name,source,assertion in variants:
  path.write_text(source);report=out/f'{name}.json';result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-submission-recovery.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=25);(out/f'{name}.log').write_text(result.stdout+result.stderr)
  data=json.loads(report.read_text());failures=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:path.write_text(original)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-submission-recovery.test.ts').read_bytes()).hexdigest()},indent=2)+'\n')
