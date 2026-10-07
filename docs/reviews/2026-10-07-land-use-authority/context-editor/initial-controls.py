import pathlib,subprocess,json,hashlib,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-context-editor-controls-v1');out.mkdir(exist_ok=False)
paths={'editor':'src/components/land-use-plans/land-use-plan-context-editor.tsx','workbench':'src/components/land-use-plans/land-use-plan-workbench.tsx','recovery':'src/lib/land-use-plans/plan-context-recovery.ts'}
original={key:(app/path).read_bytes() for key,path in paths.items()};rows=[]
def run(name,key=None,old=None,new=None,target=None):
 try:
  if key:
   source=original[key].decode();assert source.count(old)==1,(name,source.count(old));(app/paths[key]).write_text(source.replace(old,new))
  elif name=='harmless':
   for key,path in paths.items():(app/path).write_bytes(original[key]+b'\n// Harmless mounted context control.\n')
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-context-editor.test.tsx','src/test/land-use-plan-content-workbench.test.tsx','--maxWorkers=1','--reporter=json',f'--outputFile={out/name}.json'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout);report=json.loads((out/(name+'.json')).read_text());failed=[a['fullName'] for f in report['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  matched=r.returncode==0 if not target else r.returncode!=0 and any(target in title for title in failed)
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'target':target,'failedTests':failed});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:
  for key,path in paths.items():(app/path).write_bytes(original[key])
try:
 run('baseline');run('harmless')
 for case in [
 ('workbench-freeze-gate','workbench',' || contextBlocked',' || false','actual freeze control'),
 ('context-revision-read','editor','verifiedRevision === props.draftRevision && current !== null','true && current !== null','changed revision has a fresh context read'),
 ('auto-refresh-erases-draft','editor','if (!dirty && formRevision.current === originalFormRevision)','if (true)','workbench revision change while preserving'),
 ('late-initial-erases-restore','editor','if (formRevision.current === initialFormRevision)','if (true)','initial context read arrives late'),
 ('pending-edit-gate','editor','const pending = records.filter(record => !record.archived && record.value?.kind !== "draft");','const pending: PlanContextRecoveryRecord[] = [];','unknown save for explicit exact retry'),
 ('revision-read-missing','editor','if (busy || !current || verifiedRevision === props.draftRevision) return;','if (true) return;','changed revision has a fresh context read'),
 ('version-edit-gate','editor','current.versionId === props.workingVersionId','true','mismatched working versions'),
 ('staff-prop-edit-gate','editor','props.working && props.canWrite && Boolean(current?.canWrite)','props.working && true && Boolean(current?.canWrite)','mismatched working versions'),
 ('staff-read-edit-gate','editor','Boolean(current?.canWrite)','true','permission changes read-only'),
 ('manual-refresh-erases-draft','editor','setCurrent(value); setReviewed(false); if (!dirty) freshForm(value);','setCurrent(value); setReviewed(false); freshForm(value);','permission changes read-only'),
 ('confirm-erases-other-draft','editor','if (!dirty || submittedForm)','if (true)','different recovered request is confirmed'),
 ('confirmation-copy-retained','editor','setCurrent(value); acknowledgePlanContextCommand(localStorage, request, receipt);','setCurrent(value);','retains an edited draft and command before transport'),
 ('confirmation-draft-retained','editor','clearOwnedPlanContextDraft(localStorage, form, form.instanceId);','void form;','retains an edited draft and command before transport'),
 ('rebase-misses-preservation','editor','      keepDraft();\n      const place','      void form;\n      const place','restored stale bases'),
 ('rebase-ignores-proposed-area','editor','reviewArea === "proposed" && form.draft.place.mode !== "retained"','false','proposed replacement geometry'),
 ('review-checkbox-ui','editor','disabled={unavailable || !reviewed} onClick={useReviewedDraft}','disabled={unavailable} onClick={useReviewedDraft}','restored stale bases'),
 ('start-current-loses-draft','editor','try { keepDraft(); setDirty(false); }','try { setDirty(false); }','preserves the edited draft before replacing'),
 ('file-typing-generation','editor',' || read !== fileReads.current',' || false','delayed restore files replace newer typing'),
 ('file-scope-generation','editor','if (run !== generation.current || active.current || read !== fileReads.current || latest.current.disabled)','if (active.current || read !== fileReads.current || latest.current.disabled)','late restore file after the account changes'),
 ('file-size-limit','editor','file.size > 12_000_000','false','bounds restored file size'),
 ('new-draft-key','editor','const next = { ...form, instanceId: crypto.randomUUID(), savedAt:','const next = { ...form, instanceId: form.instanceId, savedAt:','recovers current typing under a new key'),
 ('clear-own-instance','recovery','if (value.instanceId !== instanceId)','if (false)','exact draft owned'),
 ('clear-own-original','recovery','if (storage.getItem(key) !== raw) throw new Error("The draft copy changed','if (false) throw new Error("The draft copy changed','exact draft owned'),
 ('clear-own-readback','recovery','if (storage.getItem(key) !== null) throw new Error("The confirmed draft copy','if (false) throw new Error("The confirmed draft copy','exact draft owned'),
 ('download-draft-bytes','editor','download(JSON.stringify(form),"openplan-context-draft.json")','download("{}","openplan-context-draft.json")','actual draft bytes'),
 ('uploaded-authority-fields','editor','<PlanAuthorityFields value={form.draft} onChange={change}','<PlanAuthorityFields value={form.draft} onChange={() => {}}','multiple responsible bodies'),
 ('uploaded-area-fields','editor','<PlanStudyAreaFields value={form.draft} onChange={change}','<PlanStudyAreaFields value={form.draft} onChange={() => {}}','multiple responsible bodies'),
 ('unresolved-recovery-freeze','editor',' || records.some(record => !record.archived)',' || false','malformed copies downloadable'),
 ('refresh-before-cleanup','editor','      confirmed = true; setNotice','      acknowledgePlanContextCommand(localStorage, request, receipt);\n      confirmed = true; setNotice','retains an edited draft and command before transport'),
 ('scope-abort','editor','generation.current = run + 1; controller.current?.abort();','generation.current = run + 1;','aborts old-account requests'),
 ]:run(*case)
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':all((app/path).read_bytes()==original[key] for key,path in paths.items()),'sourceSha256':{paths[key]:hashlib.sha256(value).hexdigest() for key,value in original.items()}},indent=2)+'\n')
