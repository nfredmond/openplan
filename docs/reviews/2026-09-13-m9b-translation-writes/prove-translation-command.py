"""Harmless and targeted mutations of the rolled-back translation command."""
from pathlib import Path
import json,subprocess

review=Path(__file__).parent
source=review/'translation-command-candidate.sql'
original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-command-controls')
private.mkdir(exist_ok=True)
def change(old,new):
    assert old in original,old
    return original.replace(old,new,1)
cases=[
 ('baseline',original,None),
 ('harmless-comment',original+'\n-- Harmless transaction note.\n',None),
 ('accept-stale-version',change("expected IS DISTINCT FROM jsonb_build_object('id',previous.id", "false AND expected IS DISTINCT FROM jsonb_build_object('id',previous.id"),'Request reuse or stale-version guard failed'),
 ('accept-stale-source',change("IF actual_source IS DISTINCT FROM entry->'expectedSource' THEN",'IF false THEN'),'Source-version guard failed'),
 ('overwrite-absent-address',change("IF has_previous OR p_operation<>'save' THEN", "IF p_operation<>'save' THEN"),'existing address presented as absent'),
 ('allow-duplicate-address',change("IF (SELECT count(*) FROM jsonb_array_elements(p_entries))<>","IF false AND (SELECT count(*) FROM jsonb_array_elements(p_entries))<>"),'duplicate address'),
 ('lose-raw-source',change('VALUES(p_campaign,p_request,auth.uid(),envelope);',"VALUES(p_campaign,p_request,auth.uid(),envelope #- '{entries,0,expectedSource,text}');"),'Exact raw source/receipt custody failed'),
 ('accept-stale-machine',change("IF previous.source_text_hash IS DISTINCT FROM translation_source_compatibility_hash(actual_source->>'text') THEN",'IF false THEN'),'stale machine source'),
 ('viewer-can-write',change("AND user_id=auth.uid() AND role IN ('owner','admin','member') FOR SHARE NOWAIT",'AND user_id=auth.uid() FOR SHARE NOWAIT'),'viewer fresh write'),
 ('viewer-can-read-receipts',change("WHERE c.id=campaign_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')","WHERE c.id=campaign_id AND m.user_id=auth.uid()"),'Viewer read receipt'),
 ('rewrite-completed-receipt',change("IF TG_OP='DELETE' OR OLD.result_json IS NOT NULL THEN","IF TG_OP='DELETE' THEN"),'Receipt immutability failed'),
 ('forge-completed-context',change('AND request_id=active_request AND actor_id=auth.uid() AND result_json IS NULL','AND request_id=active_request AND actor_id=auth.uid()'),'Completed receipt context was forged'),
 ('partial-batch',change("ORDER BY value->>'entityType',value->>'entityId',value->>'field' LOOP","ORDER BY value->>'entityType',value->>'entityId',value->>'field' LIMIT 1 LOOP"),'Whole-batch rollback failed'),
 ('drop-source-whitespace',change('||chr(65279)',"||''"),'Compatibility hash differs from JavaScript'),
]
results=[]
try:
 for name,body,target in cases:
  source.write_text(body)
  run=subprocess.run(['python3',str(review/'run-command-probe.py')],capture_output=True,text=True,timeout=90)
  output=run.stdout+run.stderr
  (private/(name+'.log')).write_text(output)
  matched=(run.returncode==0 and 'positiveCreateCorrectWithdrawRecreateAccept' in output) if target is None else (run.returncode!=0 and target in output)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'expectedFailure':target})
  assert matched,results[-1]
finally:
 source.write_text(original)
(review/'translation-command-controls.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
