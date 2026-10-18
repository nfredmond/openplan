"""Exact assertion classifier and private-source mutation campaign."""
import copy,hashlib,json,os,subprocess,sys
from pathlib import Path
BASE=Path('/home/nathaniel/.local/state/openplan/pr330-workbook-keyset-native-proof-20261015')
ROOT=BASE/'module/openplan'
REPO=Path(__file__).resolve().parents[3]
HERE=Path(__file__).parent
DEPS=Path('/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules')
ROUTE='src/app/api/projects/export/workbook/route.ts'
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n');p.chmod(0o600)
def classify(report,code,names,diagnostic=None):
 results=report.get('testResults',[])
 assert len(results)==1 and results[0]['name']==str(ROOT/'probe.test.ts'),'classifier exact file'
 alltests=results[0]['assertionResults'];tests=[r for r in alltests if r['status'] not in ('pending','skipped')]
 assert [r['title'] for r in tests]==names and names,'classifier nonempty exact names'
 assert report.get('numTotalTests')==len(alltests) and report.get('numPendingTests')==len(alltests)-len(names),'classifier counts'
 assert not report.get('numFailedTestSuites',0) or diagnostic,'classifier suite failure'
 failures=[r for r in tests if r['status']=='failed']
 if diagnostic:
  assert code==1 and len(names)==1 and len(failures)==1 and report.get('numFailedTests')==1 and report.get('numPassedTests')==0,'classifier one failure'
  messages='\n'.join(failures[0].get('failureMessages',[]));first=messages.splitlines()[0] if messages else ''
  assert first=='AssertionError: '+diagnostic or first.startswith('AssertionError: '+diagnostic+':'),'classifier exact diagnostic'
  assert not any(x in messages for x in ['TypeError','ReferenceError','SyntaxError','ECONNREFUSED','timed out','Cannot find module']),'classifier runtime refusal'
  return 'killed'
 assert code==0 and report.get('numFailedTests')==0 and report.get('numPassedTests')==len(names) and all(r['status']=='passed' for r in tests),'classifier all pass'
 return 'survived'
def selfcheck(report):
 names=[r['title'] for r in report['testResults'][0]['assertionResults'] if r['status']=='passed']
 assert classify(copy.deepcopy(report),0,names)=='survived'
 rejected=[]
 for label in ['wrong-file','wrong-name','empty','wrong-exit','runtime','wrong-diagnostic']:
  bad=copy.deepcopy(report);code=0;selected=names;diag=None
  if label=='wrong-file':bad['testResults'][0]['name']='/wrong.ts'
  elif label=='wrong-name':selected=['wrong']
  elif label=='empty':selected=[]
  elif label=='wrong-exit':code=1
  else:
   code=1;selected=[names[0]];diag='intended';bad.update(numTotalTests=1,numPendingTests=0,numFailedTests=1,numPassedTests=0)
   bad['testResults'][0]['assertionResults']=[{'title':names[0],'status':'failed','failureMessages':['TypeError: intended' if label=='runtime' else 'AssertionError: other']}]
  try:classify(bad,code,selected,diag)
  except AssertionError:rejected.append(label)
  else:raise AssertionError('classifier vacuous '+label)
 write(BASE/('classifier-cap-'+sys.argv[1]+'.json'),{'harmless':'survived','refused':rejected,'blind':'JSON classifier cannot establish SQL fixture fidelity or replace native execution'})
class Controls:
 def __init__(self,cap):
  self.cap=cap;self.out=BASE/f'cap-{cap}';self.route=ROOT/ROUTE;self.original=self.route.read_bytes();self.events=[];self.resumed=(BASE/'failed-attempt-03-cap-1000').exists()
  (ROOT/'probe.test.ts').write_bytes((HERE/'probe.test.ts').read_bytes())
  self.config=ROOT/'vitest-native.config.mjs'
  self.config.write_text('export default '+json.dumps({'resolve':{'alias':{'@':str(ROOT/'src')}},'cacheDir':str(BASE/'vite-cache'),'test':{'environment':'node','globals':True,'include':['probe.test.ts'],'testTimeout':30000,'maxWorkers':1,'fileParallelism':False}})+';\n')
 def run(self,label,selected=None,diagnostic=None):
  out=self.out/label;out.mkdir(mode=0o700)
  env=dict(os.environ,PROOF_BASE=str(BASE),PROOF_CAP=str(self.cap),PROOF_NATIVE=str(HERE/'native.py'),PROOF_OUTPUT=str(out),NODE_OPTIONS='--max-old-space-size=640',NO_PROXY='*')
  args=[str(DEPS/'.bin/vitest'),'run','--config',str(self.config),'--configLoader','native','--reporter=json','--outputFile',str(out/'report.json')]
  if selected:args+=['-t','^real native capped workbook '+selected+'$']
  p=subprocess.run(args,cwd=ROOT,env=env,capture_output=True,timeout=120);(out/'runner.log').write_bytes(p.stdout+p.stderr)
  names=[selected] if selected else (['concurrent-edit'] if self.cap==2 else ['portfolio-0','portfolio-2000','portfolio-2001','later-page-error','inaccessible-rls'])
  write(out/'exit.json',{'exit':p.returncode})
  try:
   report=json.loads((out/'report.json').read_text());result=classify(report,p.returncode,names,diagnostic)
  except BaseException as e:
   write(out/'classification.json',{'outcome':'refused','reason':str(e),'exit':p.returncode});raise
  event={'label':label,'outcome':result,'tests':names,'diagnostic':diagnostic,'exit':p.returncode,'reportSha256':hashlib.sha256((out/'report.json').read_bytes()).hexdigest()}
  write(out/'classification.json',event);self.events.append(event);write(self.out/'controls.json',self.events)
  return report
 def main(self):
  try:
   if self.cap==2:
    self.route.write_bytes(self.original+b'\n// harmless native proof control\n')
    selfcheck(self.run('harmless'))
    self.route.write_bytes(self.original)
    # Restore only the old mutable offset query/loop into the private exact module.
    old=subprocess.check_output(['git','show','401c44a0f7bfe4b54740e2c3d07e30f8ed36f169:openplan/'+ROUTE],cwd=REPO)
    self.route.write_bytes(old)
    self.run('fault-old-offset','concurrent-edit','concurrent exact original UUIDs once')
    self.route.write_bytes(self.original);self.run('restored')
   else:
    selfcheck(json.loads((BASE/'failed-attempt-03-cap-1000/remaining-rls/report.json').read_text()) if self.cap==1000 and self.resumed else self.run('baseline'))
    if self.cap==1000:
     faults=[
      ('scope','.eq("workspace_id", membership.workspace_id)','.eq("workspace_id", "00000000-0000-0000-0000-000000000000")','portfolio-0','native selected workspace predicate'),
      ('projection','  "summary",\n','','portfolio-0','native exact projection'),
      ('order','.order("id", { ascending: true })','.order("id", { ascending: false })','portfolio-0','native UUID ascending order'),
      ('limit','Math.min(pageSize, PORTFOLIO_IMPORT_MAX_ROWS + 1 - projects.length)','Math.min(pageSize - 1, PORTFOLIO_IMPORT_MAX_ROWS + 1 - projects.length)','portfolio-0','request must retain bounded sentinel limit'),
      ('short','projects.push(...page);','projects.push(...page); break;','portfolio-2000','live read must retain all supported rows or exact sentinel'),
      ('inclusive','query.gt("id", lastId)','query.gte("id", lastId)','portfolio-2000','strict cursor must use last received native UUID'),
      ('sentinel','PORTFOLIO_IMPORT_MAX_ROWS + 1 - projects.length','PORTFOLIO_IMPORT_MAX_ROWS - projects.length','portfolio-2001','request must retain bounded sentinel limit'),
      ('partial-error','if (result.error || !result.data) {','if (result.error || !result.data) break;\n      if (false) {','later-page-error','route refusal must retain exact HTTP status'),
      ('serializer','      projects,\n','      projects: projects.slice(0, 1),\n','portfolio-2000','serializer must receive every original projected row'),
      ('header','"private, no-store"','"public, max-age=3600"','portfolio-0','workbook response must remain private no-store')]
     for label,before,after,selected,diag in faults:
      if self.resumed and label in ['scope','projection','order','limit']:continue # accepted retained trials, replayed separately
      s=self.original.decode();assert s.count(before)==1,'unique mutation pin'
      try:self.route.write_text(s.replace(before,after));self.run('fault-'+label,selected,diag)
      finally:self.route.write_bytes(self.original)
  finally:
   self.route.write_bytes(self.original)
   write(self.out/'restoration.json',{'routeSha256':hashlib.sha256(self.route.read_bytes()).hexdigest(),'exact':self.route.read_bytes()==self.original,'blind':'private extracted modules only; no atomic snapshot, browser, login, Next HTTP, native Excel or full RLS acceptance'})
if __name__=='__main__':Controls(int(sys.argv[1])).main()
