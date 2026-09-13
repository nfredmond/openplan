"""Install and exercise only the unshipped candidate inside one rollback transaction."""
from pathlib import Path
import subprocess
import json

root = Path(__file__).resolve().parents[3]
review = Path(__file__).parent
container = 'supabase_db_openplan-restore-target-2731143'
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1']
version = subprocess.check_output(base + ['-Atc', 'SELECT count(*)||\':\'||max(version) FROM supabase_migrations.schema_migrations'], text=True).strip()
assert version == '328:20261014000009', version
# Compute expected compatibility hashes independently with the actual JS trim
# used by the application, including non-trimming and internal-whitespace controls.
hash_cases = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
import { createHash } from 'node:crypto';
const samples=[];
for(let cp=0;cp<65536;cp++) { const char=String.fromCodePoint(cp); if(char.trim()==='') samples.push({cp,text:char+'SYNTHETIC\\n source'+char}); }
samples.push({cp:8203,text:'\\u200bSYNTHETIC\\u200b'});
console.log(JSON.stringify(samples.map(x=>({...x,hash:createHash('sha256').update(x.text.trim()).digest('hex')}))));
"""], text=True))
assert len(hash_cases) == 26
encoded = json.dumps(hash_cases).replace("'", "''")
hash_probe = "DO $hash$ DECLARE item jsonb; BEGIN FOR item IN SELECT value FROM jsonb_array_elements('" + encoded + "'::jsonb) LOOP IF public.translation_source_compatibility_hash(item->>'text') IS DISTINCT FROM item->>'hash' THEN RAISE EXCEPTION 'Compatibility hash differs from JavaScript at %',item->>'cp'; END IF; END LOOP; END $hash$;"
sql = "BEGIN; SET LOCAL statement_timeout='25s';\n" + (review/'translation-command-candidate.sql').read_text() + '\n' + hash_probe + '\n' + (review/'translation-command-probe.sql').read_text() + '\nROLLBACK;'

run = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=60)
print(run.stdout)
print(run.stderr)
absent = subprocess.check_output(base + ['-Atc', "SELECT to_regclass('public.engagement_translation_write_receipts') IS NULL"], text=True).strip()
assert absent == 't', 'Candidate receipt table survived the rollback'
raise SystemExit(run.returncode)
