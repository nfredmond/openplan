"""Exercise real changed parsers/routes; reject runner/import failures as mutation kills."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import time

review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('http-contract-'+str(time.time_ns()))
private.mkdir(mode=0o700)
files={key:app/path for key,path in {
 'contract':'src/lib/engagement/decision-links.ts',
 'server':'src/lib/engagement/decision-links-server.ts',
 'access':'src/lib/engagement/decision-link-access.ts',
 'route':'src/app/api/engagement/campaigns/[campaignId]/decision-links/route.ts',
}.items()}
original={key:path.read_text() for key,path in files.items()}
tests=['src/test/engagement-decision-links.test.ts','src/test/engagement-decision-link-routes.test.ts']


def run(name,title=None):
 output=private/(name+'.json')
 args=['npm','exec','--','vitest','run',*tests,'--reporter=json','--outputFile='+str(output)]
 if title: args+=['-t',re.escape(title)]
 result=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=30)
 (private/(name+'.log')).write_text(result.stdout+result.stderr)
 assert output.exists(),name+': no test report'
 report=json.loads(output.read_text())
 assertions=[a for test in report['testResults'] for a in test['assertionResults']]
 if title:
  target=[a for a in assertions if a['title']==title]
  assert result.returncode!=0 and any(a['status']=='failed' for a in target),name+': targeted assertion did not fail'
 else:
  assert result.returncode==0 and report['numPassedTests']==36 and report['numFailedTests']==0,name+': baseline or harmless control failed'
 return {'case':name,'outcome':'killed' if title else 'survived','test':title,'passed':report['numPassedTests'],'failed':report['numFailedTests']}


mutations=[
 ('checksum','contract','if (actual !== expected)','if (false)','refuses altered context bytes'),
 ('context-scope','contract','campaign.id !== scope.campaignId || ','','refuses foreign context with a recomputed hash'),
 ('retained-response','contract','if (!same(withoutClock(old), withoutClock(entry)))','if (false)','refuses changed retained response content with recomputed hashes'),
 ('source-census','contract',' || context.sourceCount !== entry.source_item_ids.length','','refuses lost references even with a reduced declared count'),
 ('source-order','contract',' || item.position !== index + 1','','refuses changed order and invented unavailable content'),
 ('missing-content','contract','item.record !== null || ','','refuses changed order and invented unavailable content'),
 ('source-scope','contract',' || record.campaign_id !== scope.campaignId','','refuses foreign source records and fabricated configuration'),
 ('configuration-state','contract','if (item.configurationAvailability !== expected)','if (false)','refuses foreign source records and fabricated configuration'),
 ('definition-bytes','contract','await checkHash(definition.definitionText, definition.definitionSha256);','','checks original definition bytes and rejects unused definitions'),
 ('unused-definition','contract','if (used.size !== definitions.size)','if (false)','checks original definition bytes and rejects unused definitions'),
 ('receipt-actor','contract',' || link.actor_id !== scope.actorId','','refuses another actor, request or reason'),
 ('payload-consistency','contract','if (!same(payload, row.payload_json) || !same(payload, decisionLinkPayload(scope, intent)))','if (false)','refuses changed request bytes and contradictory row fields'),
 ('history-count','contract','snapshot.entryCount !== snapshot.entries.length || ','','refuses incomplete counts, duplicate rows and missing predecessors'),
 ('history-fork','contract',' || children.has(previous.id)','','refuses forks and duplicate roots'),
 ('duplicate-root','contract','if (roots.has(pair))','if (false)','refuses forks and duplicate roots'),
 ('history-cycle','contract','if (seen.has(parent.id)) throw new Error("Decision link history has a cycle");','if (seen.has(parent.id)) break;','refuses a cycle whose referenced rows all exist'),
 ('current-source-state','contract','|| (state.sourceState === "unchanged") !== (state.currentContextSha256 === leaf.context_sha256)','','refuses an invented source state or missing current leaf'),
 ('intent-operation','contract','(intent.operation === "link") !== (intent.predecessorId === null)','false','refuses malformed commands'),
 ('agent-refusal','route','request.headers.has(key)','false','refuses unregistered agent marker x-openplan-assistant-execution-source'),
 ('origin-refusal','route','requireProviderBrowserOrigin(request);','void request;','refuses foreign origin and changed account/workspace expectations'),
 ('account-expectation','route','request.headers.get("x-openplan-expected-user") !== access.scope.actorId','false','refuses foreign origin and changed account/workspace expectations'),
 ('workspace-expectation','route','request.headers.get("x-openplan-expected-workspace") !== access.scope.workspaceId','false','refuses foreign origin and changed account/workspace expectations'),
 ('staff-access','access',' || !access.allowed','','requires signed-in staff for reads and writes'),
 ('write-receipt-verification','server','const verified = await readDecisionLinkReceipt(reply.data, scope, intent);','const verified = { receipt: reply.data };','keeps uncertain saves uncertain rather than issuing another request'),
 ('write-request-id','server','p_request: intent.requestId','p_request: scope.actorId','sends one exact command and verifies its receipt without rereading source'),
 ('history-rpc-scope','server','{ p_campaign: scope.campaignId }','{ p_campaign: scope.workspaceId }','returns a verified complete snapshot with current actor and no-store'),
]
results=[]
try:
 results.append(run('baseline'))
 files['contract'].write_text(original['contract']+'\n// Harmless parser comment.\n')
 results.append(run('harmless-comment'))
 files['contract'].write_text(original['contract'])
 for name,key,old,new,title in mutations:
  assert original[key].count(old)==1,name+': mutation address ambiguous'
  files[key].write_text(original[key].replace(old,new,1))
  try: results.append(run(name,title))
  finally: files[key].write_text(original[key])
  print(name,'killed',flush=True)
finally:
 for key,path in files.items(): path.write_text(original[key])
 restored=all(path.read_text()==original[key] for key,path in files.items())
 (review/'decision-http-contract-results.json').write_text(json.dumps({'privateEvidence':str(private),'sourceSha256':{str(path.relative_to(app)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*files.values(),*(app/test for test in tests),app/'src/test/fixtures/decision-link-native.json']},'results':results,'sourcesRestored':restored,'limits':'Actual TypeScript parsers and Next route handlers with mocked current-user/campaign lookup and RPC transport, using native synthetic SQL packets. Does not prove live HTTP, native grants, browser navigation, storage recovery or public publication.'},indent=2)+'\n')
 assert restored
