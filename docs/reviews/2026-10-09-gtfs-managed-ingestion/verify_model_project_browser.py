"""Check recorded browser geography against the current isolated native database."""
import copy,hashlib,json,subprocess
from pathlib import Path
base=Path(__file__).parent;b=base/'browser-full-restore-02'
def read_native():
 s=json.loads((b/'fresh-services-private.json').read_text())
 def sql(db,q):return subprocess.check_output(['docker','exec','supabase_db_openplan-restore-target-2026091050','psql','-U','supabase_admin','-d',db,'-XAt','-c',q],text=True).strip()
 q="SELECT row_to_json(t) FROM (SELECT id,workspace_id,place_label,place_ref,place_geometry_geojson FROM projects WHERE id='a5b3eaad-7aa4-4693-b56a-3c77cc606abc') t"
 project=json.loads(sql(s['database'],q));source=json.loads(sql(s['sourceDatabase'],q))
 model=json.loads(sql(s['database'],"SELECT row_to_json(t) FROM (SELECT id,workspace_id,project_id,status,(SELECT count(*) FROM model_runs WHERE model_id=m.id) AS runs FROM models m WHERE id='492638e4-9937-4e61-a31c-d69f7e36f49b') t"))
 return {'project':project,'source':source,'model':model}
def verify(browser,native):
 p=native['project'];m=native['model'];c=browser['desktop']['coverage']
 assert p==native['source'],'source-geography-changed'
 assert m['project_id']==p['id'] and m['workspace_id']==p['workspace_id'],'model-project-binding'
 assert m['status']=='draft' and m['runs']==0,'unexpected-model-execution'
 g=json.dumps(p['place_geometry_geojson'],separators=(',',':'),ensure_ascii=False)
 assert hashlib.sha256(g.encode()).hexdigest()==c['geometrySha256'],'browser-geometry-mismatch'
 assert c['workspaceId']==p['workspace_id'] and c['feedId']=='16e2e138-400a-49ff-8bc3-089ff185e5d7','coverage-target-mismatch'
 assert c['status']==200 and c['response']['coverage']=='yes','coverage-response-not-established'
 assert browser['desktop']['documentWidth']==1280 and browser['mobile']['documentWidth']==390,'layout-overflow'
 assert not browser['desktop']['errors'] and not browser['mobile']['errors'],'captured-console-error'
 return True
browser=json.loads((b/'model-project-browser-public.json').read_text());native=read_native();records=[]
for label in ['baseline','harmless-field','restored']:
 x=copy.deepcopy(browser)
 if label=='harmless-field':x['reviewerNote']='Observer ignores unrelated notes.'
 assert verify(x,native);records.append({'case':label,'passed':True})
for label,target,field,value,expected in [
 ('changed-geometry','coverage','geometrySha256','0'*64,'browser-geometry-mismatch'),
 ('wrong-feed','coverage','feedId','different-feed','coverage-target-mismatch'),
 ('failed-request','coverage','status',503,'coverage-response-not-established'),
 ('mobile-overflow','mobile','documentWidth',450,'layout-overflow'),
 ('console-error','desktop','errors',['test console error'],'captured-console-error'),
 ('wrong-project','model','project_id','different-project','model-project-binding'),
 ('unexpected-run','model','runs',1,'unexpected-model-execution')]:
 x=copy.deepcopy(browser);n=copy.deepcopy(native)
 try:
  (x['desktop']['coverage'] if target=='coverage' else n['model'] if target=='model' else x[target])[field]=value
  verify(x,n)
 except AssertionError as e:
  assert str(e)==expected,(label,str(e));records.append({'case':label,'passed':True,'expectedFailure':expected})
 else:raise AssertionError('Broken behavior survived: '+label)
 finally:assert verify(browser,native)
(b/'model-project-observer-controls.json').write_text(json.dumps({'records':records,'nativeReadRepeated':True,'limits':['Controls mutate isolated copies of actual native and browser observations, not database rows or production source.','Recorded future-only console and declared viewport interval. No physical phone or scientific acceptance.']},indent=2)+'\n')
print('Three positive and seven targeted broken observation controls pass.')
