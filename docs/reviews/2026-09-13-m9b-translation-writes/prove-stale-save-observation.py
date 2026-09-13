"""Observe schema328 writes and show the diagnostic changes when stale writes are refused."""
from pathlib import Path
import os,subprocess,json,hashlib
root=Path(__file__).resolve().parent
private=Path(os.environ['OPENPLAN_TRANSLATION_PROBE_EVIDENCE']).resolve()
if private.is_relative_to(root.parents[2]): raise ValueError('Keep diagnostic logs outside the repo')
private.mkdir(parents=True,exist_ok=True)
base=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1']
ledger=subprocess.run(base,input="SELECT count(*)||'|'||max(version) FROM supabase_migrations.schema_migrations;",text=True,capture_output=True,check=True).stdout.strip()
assert ledger=='328|20261014000009',ledger
source=(root/'stale-save-probe.sql').read_text()
stale=source.replace('updated_at=EXCLUDED.updated_at;', 'updated_at=EXCLUDED.updated_at WHERE NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=translation AND revision>1);')
old_source=source.replace("WHERE id=translation;\n IF NOT EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translation AND translated_text='SYNTHETIC wording of old source')", "WHERE id=translation AND EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=campaign AND title=source_before);\n IF NOT EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translation AND translated_text='SYNTHETIC wording of old source')")
assert stale!=source and old_source!=source
results=[]
for name,sql,failure in [('baseline',source,None),('harmless-comment',source+'\n-- Harmless diagnostic comment.\n',None),('refuse-stale-version',stale,'Current stale-write behavior changed'),('refuse-changed-source',old_source,'Current source-race behavior changed')]:
 run=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=40)
 (private/(name+'.log')).write_text(run.stdout+run.stderr)
 matched=(run.returncode==0 and json.loads(run.stdout)['originalAndNewerHistoryRetained']) if failure is None else run.returncode!=0 and failure in run.stderr
 results.append({'case':name,'matched':matched,'outcome':'observed-current-behavior' if run.returncode==0 else 'rejected-changed-behavior','expectedFailure':failure})
 assert matched,run.stderr
(root/'stale-save-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'cases':results,'limits':'Diagnostic controls, not an implemented write guard. Every case runs in a rollback transaction; connections close on errors.'},indent=2)+'\n')
print(json.dumps(results))
