"""Prove the application actually queries the restricted relation; restore each fault."""
from pathlib import Path
import hashlib,json,subprocess,time
REVIEW=Path(__file__).resolve().parent
ROOT=REVIEW.parents[2]
APP=ROOT/'openplan'
PRIVATE=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('public-copy-readers-'+str(time.time_ns()))
PRIVATE.mkdir()
files={
 'portal-page':('src/lib/engagement/public-approved-items.ts','public-engagement-page.test.tsx'),
 'portal':('src/lib/engagement/public-approved-items.ts','engagement-public-feed-cursor.test.ts'),
 'json':('src/app/api/engage/[shareToken]/route.ts','engage-share-token-route.test.ts'),
 'vote':('src/app/api/engage/[shareToken]/items/[itemId]/vote/route.ts','engagement-vote-route.test.ts'),
 'photo':('src/app/api/engage/[shareToken]/items/[itemId]/photo/route.ts','engagement-public-photo-privacy.test.ts'),
 'reply':('src/app/api/engage/[shareToken]/submit/route.ts','engagement-public-submit-route.test.ts'),
 'public-report':('src/lib/engagement/survey-responses.ts','engagement-public-review-current.test.ts'),
}
original={key:(APP/path).read_text() for key,(path,_) in files.items()}
all_tests=['src/test/'+test for _,test in files.values()]
out=[]
def run(name,tests,broken=False):
 report=PRIVATE/(name+'.json')
 result=subprocess.run(['npm','exec','--','vitest','run',*tests,'--reporter=json','--outputFile='+str(report)],cwd=APP,capture_output=True,text=True,timeout=90)
 (PRIVATE/(name+'.log')).write_text(result.stdout+result.stderr)
 assert report.exists(),(name,result.returncode,result.stderr)
 data=json.loads(report.read_text())
 assert data['numTotalTests']>0 and all(suite['assertionResults'] and not suite.get('message') for suite in data['testResults']),(name,data)
 assert (result.returncode!=0 and data['numFailedTests']>0) if broken else (result.returncode==0 and data['numFailedTests']==0),(name,data)
 failed=[t['fullName'] for suite in data['testResults'] for t in suite['assertionResults'] if t['status']=='failed']
 out.append({'name':name,'outcome':'killed' if broken else 'survived','tests':data['numTotalTests'],'failed':failed})
 print(name,out[-1]['outcome'],flush=True)
run('baseline',all_tests)
p=APP/files['portal'][0]
try:
 p.write_text(original['portal']+'\n// Harmless public-reader comment.\n')
 run('harmless',all_tests)
finally:p.write_text(original['portal'])
for key,(path,test) in files.items():
 source=original[key];needle='engagement_public_items'
 for index in range(source.count(needle)):
  pieces=source.split(needle);changed=needle.join(pieces[:index+1])+'engagement_items'+needle.join(pieces[index+1:])
  p=APP/path
  assert p.read_text()==source,(key,'Source changed outside proof')
  try:
   p.write_text(changed)
   run(key+'-'+str(index+1),['src/test/'+test],True)
  finally:p.write_text(source)
assert all((APP/files[key][0]).read_text()==value for key,value in original.items())
(REVIEW/'public-copy-readers-results.json').write_text(json.dumps({'outcomes':out,'sources':{files[key][0]:hashlib.sha256(source.encode()).hexdigest() for key,source in original.items()},'privateEvidence':str(PRIVATE),'limits':['Query-boundary tests mock database rows; native candidate proof establishes view filtering separately.','No new browser or installed-migration acceptance in this record.']},indent=2)+'\n')
