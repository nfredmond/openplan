import json,pathlib,subprocess,hashlib,sys
root=pathlib.Path(__file__).parent
cases=[('harmless',0,None),('epoch:userId',1,'original intent must not submit'),('epoch:workspaceId',1,'original intent must not submit'),('epoch:projectId',1,'original intent must not submit'),('epoch:revision',1,'original intent must not submit'),('epoch:canWrite',1,'original intent must not submit'),('restart',1,'restart clears original draft'),('inflight',1,'1 !== 0'),('error',1,'prior-scope error must remain hidden'),('actor',1,'external actor identifier must be omitted'),('parser',1,'missing actor must not pass export parser'),('hashbytes',1,'Expected values to be strictly equal'),('hash',1,'generation clock must not enter canonical material'),('null',1,'legacy_study_place'),('sovereign',1,'unassessed'),('adapter',1,'bundle.projectRecord'),('gpkg',1,'GeoPackage must retain canonical readiness hash'),('report',1,'report must render canonical hash'),('auth',1,'200 !== 401'),('api',1,'Expected values to be strictly deep-equal'),('baseline',0,None)]
def classify(code,data,expected,diagnostic):
 return code==expected and ((expected==0 and data.get('result')=='SURVIVED') or (expected==1 and data.get('result')=='AssertionError' and diagnostic in data.get('diagnostic','')))
controls={'empty_rejected':not classify(1,{},1,'target'),'crash_rejected':not classify(134,{'result':'AssertionError','diagnostic':'target'},1,'target'),'type_error_rejected':not classify(1,{'result':'TypeError','diagnostic':'target'},1,'target'),'wrong_assertion_rejected':not classify(1,{'result':'AssertionError','diagnostic':'other'},1,'target'),'harmless_accepted':classify(0,{'result':'SURVIVED'},0,None),'intended_accepted':classify(1,{'result':'AssertionError','diagnostic':'target'},1,'target')}
assert all(controls.values())
results=[]
for i,(mode,expected,diagnostic) in enumerate(cases):
 run=subprocess.run(['node','--max-old-space-size=512',str(root/'probe.cjs'),mode],capture_output=True,text=True)
 (root/f'run-{i:02}.stdout').write_text(run.stdout);(root/f'run-{i:02}.stderr').write_text(run.stderr)
 try:data=json.loads(run.stdout if run.returncode==0 else run.stderr)
 except Exception:data={}
 ok=classify(run.returncode,data,expected,diagnostic)
 row={'mode':mode,'exit':run.returncode,'expectedExit':expected,'expectedDiagnostic':diagnostic,'outcome':ok,'result':data.get('result'),'diagnostic':data.get('diagnostic'),'checksReached':len(data.get('checked',[]))}
 results.append(row);(root/'independent-controls.json').write_text(json.dumps({'classifier':controls,'cases':results},indent=2)+'\n')
 print(json.dumps(row),flush=True)
 if not ok:sys.exit(2)
group=pathlib.Path('/sys/fs/cgroup')/pathlib.Path('/proc/self/cgroup').read_text().strip().split('::',1)[1].lstrip('/')
(root/'resources.json').write_text(json.dumps({k:(group/k).read_text().strip() for k in ['memory.max','memory.swap.max','memory.peak','memory.events']},indent=2)+'\n')
