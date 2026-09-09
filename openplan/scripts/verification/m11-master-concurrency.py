"""Verify two task orders cannot concurrently consume one master authorization."""
import concurrent.futures,json,os,re,subprocess,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2];os.chdir(root)
container='supabase_db_m11-contract-verification'
out=Path('/tmp/openplan-m11-concurrency');out.mkdir(exist_ok=True)
def sql(text):return subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True)
setup=Path('src/test/fixtures/contracts/setup.sql').read_text()
suite=Path('src/test/contract-master-authorization-rls.test.ts').read_text()
body=re.search(r'const master=`(.*?)`;',suite,re.S)[1]
body=re.sub(r" PERFORM public.record_contract_command\(p,owner_id,jsonb_build_object\('kind','approve'.*?;\n",'',body)
body+="RAISE NOTICE 'IDENTITY:%',jsonb_build_object('master',engagement,'owner',owner_id,'one',p,'two',element,'baselineOne',baseline,'baselineTwo',billing_rate);"
r=sql(setup.replace('-- TEST_BODY',body));assert r.returncode==0,r.stderr
ids=json.loads(re.search('IDENTITY:(.*)',r.stderr)[1]);(out/'identity.json').write_text(json.dumps(ids))
commands=[{'kind':'approve','requestId':str(uuid.uuid4()),'expectedVersion':1,'baselineId':ids[key],'approvalEvidence':'Synthetic concurrency authorization; no actual authority'} for key in ['baselineOne','baselineTwo']]
def approve(index):
 command=commands[index];engagement=ids[['one','two'][index]]
 return sql("BEGIN;SELECT public.record_contract_command('"+engagement+"','"+ids['owner']+"',$command$"+json.dumps(command)+"$command$);SELECT pg_sleep(0.25);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(approve,[0,1]))
assert sorted(r.returncode for r in results)==[0,3],[(r.returncode,r.stderr) for r in results]
assert 'Task orders exceed the shared approved master ceiling' in next(r.stderr for r in results if r.returncode)
winner=next(i for i,r in enumerate(results) if r.returncode==0)
assert approve(winner).returncode==0
r=sql("SELECT count(*)||'|'||sum((content->>'fee')::numeric) FROM public.contract_baselines WHERE engagement_id IN ('"+ids['one']+"','"+ids['two']+"') AND state='approved';")
assert r.stdout.strip()=='1|1000.00',r.stdout
report={'commands':2,'approved':1,'rejectedSharedCeiling':1,'approvedFee':'1000.00','masterCeiling':'1500.00','exactRetrySucceeded':True,'blindCategory':'Synthetic two-session overlap, not arbitrary distributed failure or actual financial authority'}
(out/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
