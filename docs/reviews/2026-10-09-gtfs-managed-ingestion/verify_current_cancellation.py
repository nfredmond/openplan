"""Challenge the recorded native and browser observations using isolated copies."""
import copy,json,sys
from pathlib import Path
proof=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).parent
base=proof/'browser-full-restore-02'
def verify(before,after,browser,mobile):
 assert browser['build']['commit']==after['sourceCommit'][:12]=='f6394f05ef03','build-identity'
 assert before['execution']['state']=='running' and before['version']['status']=='parsing' and 'gtfs-parse-child.mts' in before['children'],'active-parser-not-established'
 assert before['submission']==after['submission'],'submission-identity-changed'
 assert after['execution']['attempt']==before['execution']['attempt']==1 and after['claims']==before['claims']==1,'duplicate-worker-attempt'
 assert after['execution']['state']=='cancelled' and after['version']['status']=='failed' and after['version']['failure_code']=='abandoned' and after['execution']['token'] is None,'cancelled-terminal-not-established'
 assert after['parserAlive'] is False,'parser-still-running'
 assert after['currentVersion']==before['currentVersion'] is None and after['version']['is_current'] is False,'unexpected-adoption'
 assert after['derivedRouteRows']==after['derivedStopRows']==0,'cancelled-results-published'
 assert after['localSource']['bytes']==before['execution']['archive_identity']['bytes']==43392539 and after['localSource']['sha256']==before['execution']['archive_identity']['sha256']=='bf808d4f3c8da436f1a873aa9d2ae0e198b29017d4b06ed30f39ce56714eaaa5','saved-bytes-changed'
 assert after['storageObjects']==0 and after['storageDownload']['status']==400 and json.loads(after['storageDownload']['body'])['code']=='NoSuchKey','archive-cleanup-not-established'
 assert len(after['retired'])==1 and after['retired'][0]['last_selected_at'] is not None,'recurring-key-not-retained'
 receipt=after['cancellation']
 assert receipt['actor_id']==after['submission']['actor_id'] and receipt['command_id']=='667ec610-0cdf-44c8-a2e7-1fe3491b57c7' and len(after['terminal'])==1 and receipt['command_id'] in browser['decision'],'cancellation-receipt-binding'
 posts=browser['recorder']['requests']
 assert browser['recorder']['admissionDrops']==1 and posts[0]['droppedAcknowledgement'] and posts[0]['status']==202 and posts[1]['status']==202 and posts[0]['requestId']==posts[1]['requestId']==after['submission']['request_id'],'admission-recovery-identity'
 assert len(posts)==4 and all(r['status']==200 for r in posts[2:]) and posts[2]['url']==posts[3]['url'],'command-replay-not-established'
 assert browser['panels']==1 and browser['width']==browser['documentWidth']==1280 and mobile['width']==mobile['documentWidth']==390,'layout-overflow'
 assert not browser['recorder']['errors'] and not mobile['recorder']['errors'],'captured-console-error'
 return True
before=json.loads((base/'current-active-before-native.json').read_text());after=json.loads((base/'current-active-after-native-public.json').read_text());browser=json.loads((base/'current-journey-final-public.json').read_text());mobile=json.loads((base/'current-active-cancel-browser-public.json').read_text())
records=[]
for label in ['baseline','harmless-field','restored']:
 b=copy.deepcopy(browser)
 if label=='harmless-field':b['reviewerNote']='An unrelated observer note does not change the findings.'
 assert verify(before,after,b,mobile);records.append({'case':label,'passed':True})
variants=[
 ('different-build',lambda a,b,c,d:c['build'].update(commit='different'),'build-identity'),
 ('no-parser',lambda a,b,c,d:a.update(children=''),'active-parser-not-established'),
 ('changed-actor',lambda a,b,c,d:b['submission'].update(actor_id='different'),'submission-identity-changed'),
 ('another-claim',lambda a,b,c,d:b.update(claims=2),'duplicate-worker-attempt'),
 ('unfinished-state',lambda a,b,c,d:b['execution'].update(state='running'),'cancelled-terminal-not-established'),
 ('live-parser',lambda a,b,c,d:b.update(parserAlive=True),'parser-still-running'),
 ('adopted-version',lambda a,b,c,d:b.update(currentVersion=b['version']['id']),'unexpected-adoption'),
 ('published-results',lambda a,b,c,d:b.update(derivedStopRows=1),'cancelled-results-published'),
 ('changed-bytes',lambda a,b,c,d:b['localSource'].update(sha256='0'*64),'saved-bytes-changed'),
 ('retained-object',lambda a,b,c,d:b.update(storageObjects=1),'archive-cleanup-not-established'),
 ('unauthenticated-probe',lambda a,b,c,d:b['storageDownload'].update(status=401),'archive-cleanup-not-established'),
 ('lost-retired-key',lambda a,b,c,d:b.update(retired=[]),'recurring-key-not-retained'),
 ('different-command',lambda a,b,c,d:b['cancellation'].update(command_id='different'),'cancellation-receipt-binding'),
 ('second-admission-identity',lambda a,b,c,d:c['recorder']['requests'][1].update(requestId='different'),'admission-recovery-identity'),
 ('failed-replay',lambda a,b,c,d:c['recorder']['requests'][3].update(status=503),'command-replay-not-established'),
 ('mobile-overflow',lambda a,b,c,d:d.update(documentWidth=450),'layout-overflow'),
 ('console-error',lambda a,b,c,d:c['recorder'].update(errors=['synthetic error']),'captured-console-error')]
for label,mutate,expected in variants:
 copies=[copy.deepcopy(x) for x in [before,after,browser,mobile]]
 try:
  mutate(*copies);verify(*copies)
 except AssertionError as error:
  assert str(error)==expected,(label,str(error));records.append({'case':label,'passed':True,'expectedFailure':expected})
 else:raise AssertionError('Broken observation survived: '+label)
 finally:assert verify(before,after,browser,mobile)
(base/'current-cancellation-observer-controls.json').write_text(json.dumps({'records':records,'limits':['Controls alter isolated copies of actual observations, not application source or database rows.','Controlled acknowledgement loss occurs after an actual admission reply. It is not a public-network fault.','Future-only console observations and desktop browser at 390 CSS pixels. No physical phone, hosted service, practitioner or scientific acceptance.']},indent=2)+'\n')
print('Three positive and 17 targeted broken observation controls pass.')
