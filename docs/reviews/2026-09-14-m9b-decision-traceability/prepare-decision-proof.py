"""Copy schema only into a new, explicitly disconnected native proof database."""
import hashlib
import json
from pathlib import Path
import subprocess

review=Path(__file__).resolve().parent
container='supabase_db_openplan-restore-target-2026091050'
database='openplan_decision_link_proof_20260914'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/proof-database')
private.mkdir(parents=True,exist_ok=True)


def sql(statement, target='postgres'):
    return subprocess.run(['docker','exec','-i',container,'psql','-U','supabase_admin','-d',target,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=90)


ledger=sql('SELECT count(*)||\':\'||max(version) FROM supabase_migrations.schema_migrations;')
assert ledger.returncode==0 and ledger.stdout.strip()=='339:20261014000020',ledger.stderr
exists=sql(f"SELECT count(*) FROM pg_database WHERE datname='{database}';")
assert exists.returncode==0 and exists.stdout.strip()=='0','Proof database already exists; inspect it instead of recreating it'
dump=subprocess.run(['docker','exec',container,'pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-owner'],capture_output=True,timeout=90)
assert dump.returncode==0,dump.stderr.decode()
(private/'schema.sql').write_bytes(dump.stdout)
created=sql('CREATE DATABASE '+database+';')
assert created.returncode==0,created.stderr
restore=subprocess.run(['docker','exec','-i',container,'psql','-U','supabase_admin','-d',database,'-X','-q','-1','-v','ON_ERROR_STOP=1'],input=dump.stdout,capture_output=True,timeout=90)
(private/'restore.log').write_bytes(restore.stdout+restore.stderr)
assert restore.returncode==0,restore.stderr.decode()[-2500:]
candidates=[review/'decision-context-candidate.sql',review/'decision-link-candidate.sql',review/'decision-history-candidate.sql']
installed=sql('BEGIN;\n'+'\n'.join(p.read_text() for p in candidates)+'\nCOMMIT;',database)
(private/'candidate-install.log').write_text(installed.stdout+installed.stderr)
assert installed.returncode==0,installed.stderr
check=sql("SELECT count(*) FROM auth.users; SELECT count(*) FROM engagement_response_decision_links; SELECT count(*) FROM engagement_items;",database)
assert check.returncode==0 and check.stdout.strip()=='0\n0\n0',check.stderr
manifest={'container':container,'database':database,'sourceLedger':ledger.stdout.strip(),'schemaSha256':hashlib.sha256(dump.stdout).hexdigest(),'candidateSha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in candidates},'privateEvidence':str(private),'emptyUserAndContributionTables':True,'limits':'Schema-only native proof database. No PostgREST, auth server, browser or worker is connected. Synthetic concurrency fixtures will be retained here; never connect a worker or use this as the application database.'}
(review/'decision-proof-database.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
