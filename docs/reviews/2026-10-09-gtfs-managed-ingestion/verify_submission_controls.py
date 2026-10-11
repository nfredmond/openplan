"""Prove private admission custody and exact request recovery can refuse defects."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
here=Path(__file__).resolve().parent;root=here.parents[2]
path=root/'openplan/src/lib/gtfs/managed-admission.ts';original=path.read_text()
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
def change(before,after):
 assert original.count(before)==1,before
 return original.replace(before,after)
variants=[('baseline',original,None),('harmless',original+'\n// Harmless admission control.\n',None),
 ('binding',change('isDeepStrictEqual(saved.binding, binding)','true'),'changed actorId binding'),
 ('uploaded-hash',change('uploaded === null || isDeepStrictEqual(saved.archive, uploaded)','true'),'different upload bytes'),
 ('mutable-resolution',change('if (!saved.resolved) {','if (true) {'),'resolved URL and original new-feed intent'),
 ('authorization-replay',change('command.verify(await sendGtfsPreparedCommand(options.service, command, signal))','saved.response ?? command.verify(await sendGtfsPreparedCommand(options.service, command, signal))'),'SQL authorization'),
 ('response-retention',change('saved.response === null || isDeepStrictEqual(saved.response, response)','true'),'changed retained admission receipt'),
 ('source-bytes',change('source.kind === "upload" ? archiveIdentity !== null && source.uploadSha256 === archiveIdentity.sha256 && source.uploadBytes === archiveIdentity.bytes\n      : archiveIdentity === null','true'),'resolved ZIP identity'),
 ('local-hash',change('after.size === before.size && after.mtimeMs === before.mtimeMs && digest.digest("hex") === expected.sha256','true'),'altered local bytes'),
 ('local-size',change('requireMatch(before.size === expected.bytes, "GTFS admission archive size differs");','// Accept truncated saved files.'),'changed local archive size'),
 ('private-file',change('before.isFile() && before.uid === process.getuid?.() && (before.mode & 0o077) === 0','before.isFile()'),'public local archive'),
 ('nofollow',change('constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK','constants.O_RDONLY | constants.O_NONBLOCK'),'symlink local archive'),
 ('unbound-file',change('try { await lstat(join(options.directory, "archive.zip")); throw new Error("GTFS admission file has no binding"); }','try { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }'),'without a private request binding'),
 ('provided-cap',change('requireMatch(options.upload === undefined || options.upload.byteLength <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");','// Copy before checking the bound.').replace('requireMatch(uploaded === null || uploaded.bytes <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");','').replace('requireMatch(saved.archive === null || saved.archive.bytes <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");',''),'provided upload against the current size cap'),
 ('retained-cap',change('requireMatch(saved.archive === null || saved.archive.bytes <= limits.maxArchiveBytes, "GTFS admission archive exceeds configured bound");','// Ignore restored byte cap.'),'retained upload against the current size cap'),
 ('journal-bound',change('Buffer.byteLength(JSON.stringify(record)) <= 65536','true'),'oversized intent'),
 ('file-sync',change('await file.writeFile(upload); await file.sync();','await file.writeFile(upload);'),'private synced upload bytes'),
 ('parent-sync',change('await link(temporary, path); await syncDirectory(options.directory);','await link(temporary, path);'),'private synced upload bytes'),
 ('remote-verification',change('signal.throwIfAborted(); requireMatch(remote.ok, "GTFS admission upload is unconfirmed");','signal.throwIfAborted();'),'path-only upload success'),
 ('existing-object',change('remote.ok || remote.code === "archive_unavailable"','true'),'mismatched remote bytes'),
 ('immutable-upload',change('contentType: "application/zip", upsert: false','contentType: "application/zip", upsert: true'),'private synced upload bytes'),
 ('upload-signal',change('options.serviceKey, uploadSignal, options.storageFetch','options.serviceKey, new AbortController().signal, options.storageFetch'),'cancellation through the upload transport'),
 ('acknowledgement',change('whileActive(storage.storage.from(GTFS_UPLOADS_BUCKET).upload(archive.path, retainedBytes, { contentType: "application/zip", upsert: false }), uploadSignal)','storage.storage.from(GTFS_UPLOADS_BUCKET).upload(archive.path, retainedBytes, { contentType: "application/zip", upsert: false })'),'stalled upload acknowledgement'),
 ('confirmation-scope',change('receipt.versionId === response.versionId && isDeepStrictEqual(receipt.archive, archive)','true'),'changed archive confirmation receipt'),
 ('confirmation-status',change('status.requestId === binding.requestId && status.feedId === response.feedId && status.archiveConfirmed\n        && status.state !== "awaiting_archive"','true'),'changed archive confirmation status'),
 ('status-scope',change('requireMatch(status.requestId === binding.requestId && status.feedId === response.feedId, "GTFS admission status scope differs");','// Ignore status feed/submission scope.'),'changed requestId status'),
 ('receipt-scope',change('receipt.requestId === identity.requestId && receipt.createdFeed === (resolved.feedId === null)\n      && (resolved.feedId === null || resolved.feedId === receipt.feedId)','true'),'original request and existing feed receipts'),
 ('target',change('["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash','true'),'target admission before source work'),
 ('harmless-redundant-relative',change('isAbsolute(options.directory)','true'),None),
 ('relative-normalization',change('requireMatch(isAbsolute(options.directory), "GTFS admission directory must be absolute");','if (!isAbsolute(options.directory)) options.directory = join(process.cwd(), options.directory);'),'relative admission before source work'),
 ('pre-cancellation',change('options.signal.throwIfAborted();','// Start filesystem work after pre-cancellation.'),'cancelled admission before source work'),
 ('lock',change('const lock = await acquireConnectorLock(options.directory), ending = new AbortController();','await import("../../../../workers/planner_agent_connector/connector-worker.mjs").then(m => m.privateConnectorDirectory(options.directory));\n  const lock = { signal: new AbortController().signal, release: async () => {} }, ending = new AbortController();'),'second admission process'),
 ('source-metadata',change('normalizeGtfsSourceUrl(source.sourceUrl) === source.normalizedSourceUrl','true'),'inconsistent source metadata'),
 ('restored',original,None)]
records=[]
try:
 for name,source,assertion in variants:
  path.write_text(source);report=out/f'{name}.json'
  result=subprocess.run([str(root/'openplan/node_modules/.bin/vitest'),'run','src/test/gtfs-managed-admission.test.ts','--maxWorkers=1','--reporter=json',f'--outputFile={report}'],cwd=root/'openplan',capture_output=True,text=True,timeout=20)
  (out/f'{name}.log').write_text(result.stdout+result.stderr);data=json.loads(report.read_text())
  failures=[c['fullName'] for s in data['testResults'] for c in s['assertionResults'] if c['status']=='failed']
  if assertion:assert result.returncode!=0 and any(assertion in case for case in failures),(name,failures)
  else:assert result.returncode==0 and not failures,(name,failures)
  records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','failedAssertions':failures});print(name,records[-1]['result'],flush=True)
finally:path.write_text(original)
summary={'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'testSha256':hashlib.sha256((root/'openplan/src/test/gtfs-managed-admission.test.ts').read_bytes()).hexdigest(),'records':records}
(out/'result.json').write_text(json.dumps(summary,indent=2)+'\n')
