"""Prove saved-setting refresh and draft isolation checks, restoring source bytes."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan';source=app/'src/components/engagement/engagement-share-controls.tsx';original=source.read_text()
tests=['src/test/engagement-share-controls-'+name+'.test.tsx' for name in ['refresh','slug','regenerate','embed']]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/share-settings-refresh-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
cases=[('baseline',original,None),('harmless-comment',original+'\n// Harmless share settings control.\n',None)]
def mutate(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new,1),expected))
mutate('freeze-untouched-values','  return [current?.value ?? saved,','  const [initial] = useState(saved);\n  return [current?.value ?? initial,','reflects publishing changes')
mutate('discard-unsaved-draft','const current = draft?.campaignId === campaignId && !equal(draft.value, saved) ? draft : null;','const current = null;','preserves a slug draft')
mutate('carry-foreign-draft','draft?.campaignId === campaignId','draft !== null','never carries an old draft')
mutate('revive-confirmed-draft','if (draft !== null && current === null) setDraft(null);','/* Confirmation not cleared. */','releases a confirmed draft')
mutate('draft-is-live-status','const portalState = getPublicPortalState(campaign);','const portalState = getPublicPortalState({ ...campaign, allow_public_submissions: allowSubmissions });','keeps unsaved submission changes separate')
mutate('send-untouched-description','...(descriptionEdited ? { publicDescription: publicDescription.trim() || null } : {}),','publicDescription: publicDescription.trim() || null,','preserves a slug draft')
mutate('send-untouched-submissions','...(submissionsEdited ? { allowPublicSubmissions: allowSubmissions } : {}),','allowPublicSubmissions: allowSubmissions,','preserves a slug draft')
mutate('send-untouched-demographics','...(demographicsEdited ? { demographicsEnabled } : {}),','demographicsEnabled,','preserves a slug draft')
mutate('lose-explicit-description-clear','{ publicDescription: publicDescription.trim() || null }','{ publicDescription: publicDescription.trim() }','keeps explicit empty descriptions')
mutate('lose-explicit-slug-clear','publicSlug: normalizedSlug === "" ? null : normalizedSlug','publicSlug: normalizedSlug','clears with an emptied field')
mutate('lose-false-demographics','...(demographicsEdited ? { demographicsEnabled } : {}),','...(demographicsEdited && demographicsEnabled ? { demographicsEnabled } : {}),','sends a changed demographics setting')
mutate('settings-replay-share-token','...(descriptionEdited ? { publicDescription: publicDescription.trim() || null } : {}),','shareToken, ...(descriptionEdited ? { publicDescription: publicDescription.trim() || null } : {}),','saving share settings never sends a token')
mutate('enable-untouched-save','disabled={isSubmitting || !hasEdits}','disabled={isSubmitting}','makes an untouched or reverted save a no-op')
mutate('erase-newer-draft-on-confirmation','  const current = draft?.campaignId', '  const [previousSaved, setPreviousSaved] = useState(saved);\n  if (!equal(previousSaved, saved)) { setPreviousSaved(saved); setDraft(null); }\n  const current = draft?.campaignId','preserves a newer edit')
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;output=private/(name+'.json');source.write_text(body)
  args=['npm','exec','--','vitest','run',*tests,'--reporter=json','--outputFile='+str(output)]
  if expected:args+=['-t',re.escape(expected)]
  try:run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=35)
  finally:source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(output.read_text());failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  assert report['numPassedTests']+report['numFailedTests']>0,(name,'no selected tests')
  correct=run.returncode==0 and report['numPassedTests']==25 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,correct,flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'share-settings-refresh-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'tests':{f:hashlib.sha256((app/f).read_bytes()).hexdigest() for f in tests},'privateEvidence':str(private),'results':results,'limits':'Real React component with controlled prop refreshes and mocked fetch. Does not prove browser reachability, backend concurrent-write conflicts or account authorization. Server values must themselves distinguish successful reads from unavailable fields.'},indent=2)+'\n')
