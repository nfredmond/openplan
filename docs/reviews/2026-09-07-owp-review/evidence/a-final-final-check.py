import pathlib,json,subprocess,re,hashlib
root=pathlib.Path('/tmp/owp-review-a/final');container='supabase_db_owp-independent-review-a-final'
def sql(s):
 p=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],input=s,text=True,capture_output=True)
 assert p.returncode==0,p.stderr
 return p.stdout.strip()
before=json.loads((root/'before.json').read_text())
def snapshot_sql():return "SELECT jsonb_build_object("+','.join("'"+t+"',(SELECT jsonb_agg(to_jsonb(x)-'amendment_baseline_id'-'work_program_packet_id'-'work_program_packet_format' ORDER BY id) FROM public."+t+" x)" for t in before)+");"
assert json.loads(sql(snapshot_sql()))==before,'Retained rows changed after probes'
noop=json.loads(sql('BEGIN; SELECT 1;'+snapshot_sql()+'ROLLBACK;').splitlines()[-1]);assert noop==before
changed=json.loads(sql("BEGIN; UPDATE public.kb_documents SET title='Synthetic deliberate corruption probe' WHERE id=(SELECT id FROM review_a.identities WHERE k='document');"+snapshot_sql()+'ROLLBACK;'));assert changed!=before,'Snapshot comparison cannot detect mutation'
assert json.loads(sql(snapshot_sql()))==before
restored=[]
for file in (root/'captured').glob('*.sql'):
 for name,body in re.findall(r'CREATE(?: OR REPLACE)? FUNCTION public\.(\w+)\(.*?AS \$\$(.*?)\$\$;',file.read_text(),re.S):
  actual=json.loads(sql("SELECT to_jsonb(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='"+name+"';"))
  assert actual==body,(name,'Function not restored');restored.append(name)
assert sql('SELECT count(*) FROM public.program_work_program_events;')=='0'
repo=pathlib.Path('/home/nathaniel/.local/state/openplan/owp-review-2026-09-07')
assert all((repo/'openplan/supabase/migrations'/p.name).read_bytes()==p.read_bytes() for p in (root/'captured').glob('*.sql')),'Root migrations changed since capture'
result={'snapshot_noop_survived':True,'altered_document_title_detected':True,'all_predecessor_rows_restored':True,'workflow_events_after_probes':0,'functions_restored':restored,'current_migrations_match_capture':True}
(root/'restoration-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
