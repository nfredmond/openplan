"""Exercise overlapping billing transactions in the explicitly isolated upgrade stack."""
import concurrent.futures, json, os, re, subprocess, uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
os.chdir(root)
container='supabase_db_contract-verification-upgrade'
out=Path('/tmp/openplan-contract-concurrency');out.mkdir(exist_ok=True)
def sql(body):
 return subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=body,text=True,capture_output=True)
suite=Path('src/test/contract-reconciliation-rls.test.ts').read_text()
setup=Path('src/test/fixtures/contracts/setup.sql').read_text()
parts={key:re.search(r'const '+key+r' = `([\s\S]*?)`;',suite)[1] for key in ['saveBaseline','time','approve']}
body=parts['saveBaseline']+parts['time']+'PERFORM public.record_contract_command(engagement,member_id,c);'+parts['approve']+"""
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic concurrency rate'));
 RAISE NOTICE 'IDENTITY:%',jsonb_build_object('engagement',engagement,'owner',owner_id,'entry',entry);
"""
r=sql(setup.replace('-- TEST_BODY',body));assert r.returncode==0,r.stderr
ids=json.loads(re.search(r'IDENTITY:(.*)',r.stderr)[1]);(out/'identity.json').write_text(json.dumps(ids))
commands=[{'kind':'bill','requestId':str(uuid.uuid4()),'invoiceNumber':'SYNTH-CONCURRENT-'+str(i),'invoiceDate':'2026-09-08','dueDate':None,'retentionPercent':'10.00','entryIds':[ids['entry']]} for i in range(2)]
def bill(command):
 return sql("BEGIN;SELECT public.record_contract_command('"+ids['engagement']+"','"+ids['owner']+"',$command$"+json.dumps(command)+"$command$);SELECT pg_sleep(0.3);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(bill,commands))
assert sorted(r.returncode for r in results)==[0,3],[(r.returncode,r.stderr) for r in results]
failed=next(r for r in results if r.returncode);assert 'Only approved, allocated, unbilled labor and expenses may be billed' in failed.stderr,failed.stderr
q=sql("SELECT jsonb_build_object('invoices',count(*),'gross',sum(subtotal_amount),'net',sum(total_amount),'lines',(SELECT count(*) FROM client_invoice_line_items l JOIN client_invoices i ON i.id=l.invoice_id WHERE i.engagement_id='"+ids['engagement']+"'),'sources',(SELECT count(*) FROM contract_billing_sources WHERE engagement_id='"+ids['engagement']+"')) FROM client_invoices WHERE engagement_id='"+ids['engagement']+"';")
position=json.loads(q.stdout);assert position=={'invoices':1,'gross':101.00,'net':90.90,'lines':2,'sources':1},position
winner=commands[next(i for i,r in enumerate(results) if r.returncode==0)]
again=bill(winner);assert again.returncode==0,again.stderr
report={'simultaneousCommands':2,'committed':1,'rejectedAsAlreadyBilled':1,'retrySucceeded':True,'position':position,'blindCategory':'Synthetic two-session race; not arbitrary distributed failure or external accounting acceptance'}
(out/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
