"""Bind terminal controller health to modeled run receipts, without survey access."""
import hashlib,json
from pathlib import Path
E=Path(__file__).resolve().parent;R=Path('data/_screening_cache/tbi2019-integration')
controller=json.loads((E/'pipeline-status.allocator.json').read_text())
if controller.get('status')!='model_attempts_finished':raise RuntimeError('Both attempts must be terminal')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
for stage in controller['stages']:
 arm=stage['name'];p=E/('modeled-'+arm+'.json');raw=json.loads(p.read_text())
 record=json.loads((E/('modeled-'+arm+'.started.json')).read_text())
 record.update(raw)
 record.update(started_at=stage['started_at'],finished_at=stage['finished_at'],controller_exit_code=stage['exit_code'],scope_properties=stage['scope_properties'])
 if 'Result=oom-kill' in stage['scope_properties']:
  record.update(completion='failed',reason='6 GiB scope OOM kill during high-school location logsum preprocessing; no completed tours',tour_count=None,mode_counts_MODELED=None,mode_shares_MODELED=None)
 output=R/('modeled-'+arm)
 record['stdout_sha256']=sha(output/'stdout.log')
 record['stdout_bytes']=(output/'stdout.log').stat().st_size
 record['last_log_line']=(output/'stdout.log').read_text().splitlines()[-1]
 record['retained_run_directory']=str(output.resolve())
 record['outcomes_accessed']=False
 record['comparison_computed']=False
 p.write_text(json.dumps(record,indent=2)+'\n')
 print(json.dumps({'arm':arm,'completion':record['completion'],'scope':stage['scope_properties'],'last_log_line':record['last_log_line']}))
