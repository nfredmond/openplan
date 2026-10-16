"""Named native controls. Runtime/setup failures never count as assertion kills."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

BASE=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015')
REPO=Path(__file__).resolve().parents[3]
DEPS=Path('/home/nathaniel/code/openplan/openplan/node_modules')
ROUTE='src/app/api/projects/export/workbook/route.ts'

def write(path,data):
    path.write_text(json.dumps(data,indent=2)+'\n');path.chmod(0o600)

def classify(report,code,names,diagnostic=None):
    results=report.get('testResults',[])
    assert len(results)==1 and results[0]['name']==str(BASE/'54537205/openplan/probe.test.ts'),'classifier exact file'
    all_tests=results[0]['assertionResults']
    tests=[r for r in all_tests if r['status'] not in ('pending','skipped')]
    assert [r['title'] for r in tests]==names,'classifier exact selected tests'
    assert report.get('numTotalTests')==len(all_tests) and report.get('numPendingTests')==len(all_tests)-len(names) and len(names)>0,'classifier nonempty exact count'
    failures=[r for r in tests if r['status']=='failed']
    if diagnostic:
        assert code==1 and len(names)==1 and len(failures)==1 and report.get('numFailedTests')==1 and report.get('numPassedTests')==0,'classifier exact one failure'
        messages='\n'.join(failures[0].get('failureMessages',[]))
        first=messages.splitlines()[0] if messages else ''
        assert first=='AssertionError: '+diagnostic or first.startswith('AssertionError: '+diagnostic+':'), 'classifier exact assertion diagnostic'
        assert not any(s in messages for s in ['Cannot find module','SyntaxError','ReferenceError','TypeError','ECONNREFUSED','timed out']),'classifier rejects runtime failures'
        return 'killed'
    assert code==0 and report.get('numFailedTests')==0 and report.get('numPassedTests')==len(names),'classifier all selected pass'
    assert all(r['status']=='passed' for r in tests),'classifier statuses pass'
    return 'survived'

def selfcheck(report):
    names=[r['title'] for r in report['testResults'][0]['assertionResults']]
    assert classify(report,0,names)=='survived','classifier harmless baseline survivor'
    bad=copy.deepcopy(report);bad['numTotalTests']=0
    variants=[('empty',bad,0,names,None),('wrong-file',dict(report,testResults=[dict(report['testResults'][0],name='/wrong.ts')]),0,names,None),
        ('wrong-name',report,0,['wrong'],None),('nonzero-success',report,1,names,None),('false-kill',report,1,names,'expected diagnostic')]
    fake={'numTotalTests':1,'numPendingTests':0,'numFailedTests':1,'numPassedTests':0,'testResults':[{'name':str(BASE/'54537205/openplan/probe.test.ts'),'assertionResults':[{'title':'t','status':'failed','failureMessages':['AssertionError: expected diagnostic']}]}]}
    assert classify(fake,1,['t'],'expected diagnostic')=='killed','classifier intended assertion baseline'
    for label,msg in [('runtime','TypeError: expected diagnostic'),('wrong-assertion','AssertionError: other'),('embedded-diagnostic','AssertionError: unrelated: expected diagnostic'),('timeout','AssertionError: expected diagnostic timed out')]:
        value=copy.deepcopy(fake);value['testResults'][0]['assertionResults'][0]['failureMessages']=[msg]
        variants.append((label,value,1,['t'],'expected diagnostic'))
    rejected=[]
    for label,value,code,selected,diagnostic in variants:
        try:classify(value,code,selected,diagnostic)
        except AssertionError:rejected.append(label)
        else:raise AssertionError('classifier must reject '+label)
    write(BASE/'classifier-controls.json',{'harmless':'survived','namedAssertion':'killed','refused':rejected,'blind':'Report classification cannot establish native database or fixture fidelity.'})

class Controls:
    def __init__(self,cap):
        self.cap=cap;self.out=BASE/f'cap-{cap}'
        self.root=BASE/'54537205/openplan'
        self.route=self.root/ROUTE
        self.original=self.route.read_bytes()
        self.events=[]
        self.probe=self.root/'probe.test.ts'
        self.probe.write_bytes((Path(__file__).parent/'probe.test.ts').read_bytes())
        self.config=self.root/'vitest-native.config.mjs'
        self.config.write_text('export default '+json.dumps({'resolve':{'alias':{'@':str(self.root/'src')}},'cacheDir':str(BASE/'vite-cache'),
            'test':{'environment':'node','globals':True,'include':['probe.test.ts'],'testTimeout':30000,'maxWorkers':1,'fileParallelism':False}})+';\n')

    def run(self,label,selected=None,diagnostic=None,original=False):
        out=self.out/label;out.mkdir(mode=0o700)
        env=dict(os.environ,PROOF_BASE=str(BASE),PROOF_CAP=str(self.cap),PROOF_OUTPUT=str(out),PROOF_ORIGINAL='1' if original else '0',NODE_OPTIONS='--max-old-space-size=640',NO_PROXY='*')
        args=[str(DEPS/'.bin/vitest'),'run','--config',str(self.config),'--configLoader','native','--reporter=json','--outputFile',str(out/'report.json')]
        if selected:args+=['-t',('^original native capped workbook ' if original else '^real native capped workbook ')+selected+'$']
        p=subprocess.run(args,cwd=self.root,env=env,capture_output=True,timeout=180)
        (out/'runner.log').write_bytes(p.stdout+p.stderr)
        if not (out/'report.json').exists():raise AssertionError('runtime missing report '+label)
        report=json.loads((out/'report.json').read_text())
        names=[selected] if selected else (['original-2000','original-2001'] if original else ['portfolio-0','portfolio-1000','portfolio-2000','portfolio-2001','later-page-error'])
        try:result=classify(report,p.returncode,names,diagnostic)
        except AssertionError as e:
            write(out/'classification.json',{'outcome':'refused','reason':str(e),'exit':p.returncode});raise
        event={'label':label,'outcome':result,'tests':names,'diagnostic':diagnostic,'exit':p.returncode}
        write(out/'classification.json',event);self.events.append(event);write(self.out/'controls.json',self.events)
        return report

    def replace(self,before,after):
        text=self.original.decode();assert text.count(before)==1,'unique private mutation source binding'
        self.route.write_text(text.replace(before,after))

    def main(self):
        try:
            baseline=self.run('baseline-'+uuid.uuid4().hex[:6]);selfcheck(baseline)
            self.route.write_bytes(self.original+b'\n// harmless native control comment\n')
            self.run('harmless-'+uuid.uuid4().hex[:6]);self.route.write_bytes(self.original)
            if self.cap==1000:
                base_route=BASE/'b259d73e/openplan'/ROUTE
                self.route.write_bytes(base_route.read_bytes())
                self.run('original-reproduction',original=True);self.route.write_bytes(self.original)
                faults=[
                    ('first-page-end','projects.push(...page);','projects.push(...page); break;','portfolio-2000','live read must retain all supported rows or exact sentinel'),
                    ('progress-by-request','projects.length, Math.min(projects.length + pageSize - 1','projects.length + 1, Math.min(projects.length + pageSize - 1','portfolio-2000','live paging offset must advance by actual received rows'),
                    ('projection-summary','  "summary",\n','','portfolio-1000','native query projection must retain all exact selected columns'),
                    ('scope-omitted','        .eq("workspace_id", membership.workspace_id)\n','','portfolio-1000','native query must use selected workspace'),
                    ('date-order','order("updated_at", { ascending: false })','order("updated_at", { ascending: true })','portfolio-1000','native query must use timestamp desc and id asc'),
                    ('tie-order','order("id", { ascending: true })','order("id", { ascending: false })','portfolio-1000','native query must use timestamp desc and id asc'),
                    ('sentinel-end','projects.length + pageSize - 1, PORTFOLIO_IMPORT_MAX_ROWS','projects.length + pageSize - 1, PORTFOLIO_IMPORT_MAX_ROWS - 1','portfolio-2001','live inclusive request must end at bounded sentinel'),
                    ('success-status','      status: 200,','      status: 201,','portfolio-0','complete workbook must retain HTTP 200'),
                    ('refusal-status','{ status: 409 }','{ status: 400 }','portfolio-2001','route refusal must retain exact HTTP status'),
                    ('failure-status','{ error: "Failed to read the project portfolio" }, { status: 500 }','{ error: "Failed to read the project portfolio" }, { status: 409 }','later-page-error','route refusal must retain exact HTTP status'),
                    ('error-partial-workbook','      if (result.error || !result.data) {','      if (result.error || !result.data) break;\n      if (false) {','later-page-error','route refusal must retain exact HTTP status'),
                    ('serializer-input','      projects,\n','      projects: projects.slice(0, 1),\n','portfolio-1000','serializer must receive every original projected row'),
                    ('workspace-metadata','      workspaceName,\n','      workspaceName: "Substituted workspace",\n','portfolio-1000','serializer must retain selected workspace name'),
                    ('unknown-year','      projects,\n','      projects: projects.map(p => ({...p, estimated_cost_basis_year: 2026})),\n','portfolio-1000','serializer must receive every original projected row'),
                    ('cache-header','"private, no-store"','"public, max-age=3600"','portfolio-0','workbook response must remain private no-store'),
                ]
                for label,before,after,selected,diagnostic in faults:
                    try:
                        self.replace(before,after);self.run('fault-'+label,selected,diagnostic)
                    finally:self.route.write_bytes(self.original)
                    self.run('restored-'+label,selected)
            else:
                try:
                    self.replace('if (page.length === 0) break;','if (page.length < pageSize) break;')
                    self.run('fault-short-page','portfolio-2000','live read must retain all supported rows or exact sentinel')
                finally:self.route.write_bytes(self.original)
            self.run('restored-final')
        finally:
            self.route.write_bytes(self.original)
            write(self.out/'restoration.json',{'routeSha256':hashlib.sha256(self.route.read_bytes()).hexdigest(),'exactRestoration':self.route.read_bytes()==self.original,
                'blind':'Stable synthetic JWT/native GET execution; no Next server, cookie, browser or snapshot acceptance.'})

    def extra(self):
        try:
            original=(BASE/'b259d73e/openplan'/ROUTE).read_bytes()
            for count in [2000,2001]:
                selected='original-'+str(count)
                self.route.write_bytes(original)
                self.run('original-oracle-baseline-'+str(count),selected,original=True)
                self.route.write_bytes(original+b'\n// harmless original source comment\n')
                self.run('original-oracle-harmless-'+str(count),selected,original=True)
                self.route.write_bytes(self.original)
                self.run('original-oracle-corrected-source-'+str(count),selected,'original must issue one capped read',original=True)
                self.route.write_bytes(original)
                self.run('original-oracle-restored-'+str(count),selected,original=True)
            self.route.write_bytes(self.original)
            self.run('restored-final')
        finally:
            self.route.write_bytes(self.original)
            write(self.out/'restoration.json',{'routeSha256':hashlib.sha256(self.original).hexdigest(),'exactRestoration':self.route.read_bytes()==self.original})

if __name__=='__main__':
    controller=Controls(int(sys.argv[1]))
    if len(sys.argv)>2 and sys.argv[2]=='extra':controller.extra()
    else:controller.main()
