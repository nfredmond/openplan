"""Read-only controls for the actual database/helper allowlists."""
import copy,json
import native as m
n=m.Native();events=[]
# Harmless native read succeeds. Unauthorized connections refuse before SQL.
with n.connect(n.plan['target'],True) as c:assert n.query(c,'select 1 value')[0]['value']==1
for db,readonly in [(m.SOURCE,False),('openplan_pr330_native_unallocated',False),('postgres',True)]:
 try:n.connect(db,readonly)
 except AssertionError as e:assert str(e)=='database allowlist';events.append('database-'+db)
 else:raise AssertionError('database allowlist survived forbidden target')
original=m.command
try:
 for key,value in [('Id','wrong'),('Name','/wrong'),('State',{'Running':False})]:
  broken=copy.deepcopy(n.info);broken[key]=value
  m.command=lambda args,**kw:json.dumps([broken]).encode()
  try:m.Native()
  except AssertionError as e:assert str(e)=='cluster identity';events.append('cluster-'+key)
  else:raise AssertionError('cluster guard survived '+key)
finally:m.command=original
assert m.Native().info['Id']==n.info['Id']
# Challenge the exact same helper guard used before stopping an owned helper.
receipts=sorted(m.BASE.glob('cap-*/receipt.json'));helper=[]
for p in receipts:
 receipt=json.loads(p.read_text());v=json.loads(m.command(['docker','inspect',receipt['id']]))[0]
 env=dict(x.split('=',1) for x in (p.parent/'runtime-private.env').read_text().splitlines());uri=env['PGRST_DB_URI']
 def guard(x):m.guard_helper(x,receipt['id'],receipt['name'],n.plan['target'],uri)
 guard(v);harmless=copy.deepcopy(v);harmless['HarmlessReceiptMetadata']=True;guard(harmless)
 if not helper:
  mutations=[('identity',lambda x:x.update(Id='wrong')),('name',lambda x:x.update(Name='/wrong')),('image',lambda x:x.update(Image='wrong')),('memory',lambda x:x['HostConfig'].update(Memory=0)),('swap',lambda x:x['HostConfig'].update(MemorySwap=-1)),('cpu',lambda x:x['HostConfig'].update(NanoCpus=0)),('pids',lambda x:x['HostConfig'].update(PidsLimit=0)),('target',lambda x:x['Config']['Labels'].update({'openplan.proof.database':m.SOURCE})),('mount',lambda x:x.update(Mounts=[{'Source':'wrong'}])),('port',lambda x:x['HostConfig'].update(PortBindings={})),('uri',lambda x:x['Config'].update(Env=[e for e in x['Config']['Env'] if not e.startswith('PGRST_DB_URI=')]+['PGRST_DB_URI=postgres://wrong']))]
  for label,mutate in mutations:
   broken=copy.deepcopy(v);mutate(broken)
   try:guard(broken)
   except AssertionError:helper.append(label)
   else:raise AssertionError('helper guard survived '+label)
 guard(v)
 assert not v['State']['Running'] and not v['State']['OOMKilled']
m.write(m.BASE/'safety.json',{'harmlessNativeRead':'survived','databaseAndClusterRefusals':events,'helperHarmlessMetadata':'survived','helperRefusals':helper,'exactRestore':True,'blind':'identity/config controls use copied real readbacks; they do not prove Docker or PostgreSQL isolation against a malicious host'})
