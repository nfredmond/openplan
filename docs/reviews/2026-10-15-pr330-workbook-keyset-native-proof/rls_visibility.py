"""Supplement native GET traces with read-only authenticated-role visibility."""
import contextlib,json,uuid
import native as m
n=m.Native();fixtures=json.loads((m.BASE/'fixtures-private.json').read_text());visible=next(p for p in fixtures['portfolios'] if p['count']==7);hidden=next(p for p in fixtures['portfolios'] if p['count']==3)
def read(actor):
 with contextlib.closing(n.connect(n.plan['target'],True)) as c:
  n.query(c,'BEGIN READ ONLY');n.query(c,'SET LOCAL ROLE authenticated')
  n.query(c,"select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor,'role':'authenticated'}),))
  counts={p['count']:n.query(c,'select count(*) count from public.projects where workspace_id=%s',(p['workspace'],))[0]['count'] for p in [visible,hidden]}
  n.query(c,'ROLLBACK');return counts
actual=read(fixtures['actor'])
def verify(rows):assert rows=={7:7,3:0},'native authenticated visibility'
verify(actual);verify(dict(actual))
wrong=read(str(uuid.uuid4()))
try:verify(wrong)
except AssertionError as e:assert str(e)=='native authenticated visibility';fault='killed'
else:raise AssertionError('visibility fault survived unrelated actor')
restored=read(fixtures['actor']);verify(restored)
m.write(m.BASE/'rls-visibility.json',{'actual':actual,'harmlessCopy':'survived','unrelatedActor':wrong,'intendedFault':fault,'restored':restored,'readOnly':True,'blind':'This authenticated-role SQL read supplements actual GET/PostgREST tests. It does not establish cookie auth, every policy, membership freshness or full RLS acceptance.'})
