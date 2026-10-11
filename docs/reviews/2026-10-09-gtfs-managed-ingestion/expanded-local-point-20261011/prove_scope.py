"""Actual extracted ownership controls, with no native effects."""
import ast,copy,hashlib,json
from pathlib import Path
import scope as s

p=Path(__file__).parent;source=p/'scope.py';plan=json.loads((p/'plan.json').read_text());snapshots=json.loads((p/'source-services-private.json').read_text())
fixtures={
 'verify_database':[{'Id':s.DB_ID,'Name':'/'+s.DB_NAME,'State':{'Running':True},'Config':{'Labels':{'com.supabase.cli.project':'openplan-restore-target-2026091050'}}}],
 'verify_original':['storage',snapshots['storage']],
 'verify_plan':[plan,s.HEAD,'',[],False,False,0,0,0],
 'verify_properties':[{'encoding':'UTF8','localeProvider':'i','connectionLimit':-1},0],
 'verify_pending':[{'versionId':'synthetic','settled':False},{'payload':{'operation':'complete'},'resolved':False,'receipt':None},'synthetic'],
}
variants=[
 ('verify_database','expanded-database-identity',lambda a:a[0].update(Id='foreign')),
 ('verify_database','expanded-database-owner',lambda a:a[0]['Config']['Labels'].update({'com.supabase.cli.project':'foreign'})),
 ('verify_original','expanded-original-identity',lambda a:a[1].update(Id='foreign')),
 ('verify_original','expanded-original-identity',lambda a:a[1].update(Name='/foreign')),
 ('verify_original','expanded-original-identity',lambda a:a[1].update(Image='foreign')),
 ('verify_original','expanded-original-owner-state',lambda a:a[1]['Config']['Labels'].update({'openplan.purpose':'foreign'})),
 ('verify_original','expanded-original-owner-state',lambda a:a[1]['State'].update(Running=False)),
 ('verify_original','expanded-original-network',lambda a:a[1]['NetworkSettings']['Networks'].update(foreign={})),
 ('verify_original','expanded-original-limits',lambda a:a[1]['HostConfig'].update(MemorySwap=-1)),
 ('verify_original','expanded-original-uri',lambda a:a[1]['Config'].update(Env=['DATABASE_URL=postgres://localhost/foreign'])),
 ('verify_original','expanded-original-mounts',lambda a:a[1]['Mounts'][0].update(Source='/foreign')),
 ('verify_original','expanded-original-gateway',lambda a:(a.__setitem__(0,'gateway'),a.__setitem__(1,copy.deepcopy(snapshots['gateway'])),a[1]['HostConfig']['PortBindings']['8000/tcp'][0].update(HostIp='0.0.0.0'))),
 ('verify_plan','expanded-source',lambda a:a.__setitem__(1,'foreign')),
 ('verify_plan','expanded-source',lambda a:a.__setitem__(2,' M file')),
 ('verify_plan','expanded-plan-identity',lambda a:a[0].update(logicalApi='https://hosted.invalid')),
 ('verify_plan','expanded-fresh-names',lambda a:a[0].update(targetDatabase=a[0]['sourceDatabase'])),
 ('verify_plan','expanded-fresh-names',lambda a:a[0].update(targetDatabase='postgres')),
 ('verify_plan','expanded-existing-database',lambda a:a[3].append(a[0]['sourceDatabase'])),
 ('verify_plan','expanded-active-owner',lambda a:a.__setitem__(4,True)),
 ('verify_plan','expanded-active-owner',lambda a:a.__setitem__(5,True)),
 ('verify_plan','expanded-unquiesced-jobs',lambda a:a.__setitem__(6,1)),
 ('verify_plan','expanded-unquiesced-jobs',lambda a:a.__setitem__(7,1)),
 ('verify_plan','expanded-unquiesced-jobs',lambda a:a.__setitem__(8,1)),
 ('verify_properties','expanded-locale',lambda a:a[0].update(localeProvider='unknown')),
 ('verify_properties','expanded-delegated-grantors',lambda a:a.__setitem__(1,1)),
 ('verify_properties','expanded-connection-limit',lambda a:a[0].update(connectionLimit=-2)),
 ('verify_pending','expanded-pending-job',lambda a:a[0].update(settled=True)),
 ('verify_pending','expanded-pending-completion',lambda a:a[1].update(resolved=True)),
]
records=[]
for label in ('baseline','harmless','restored'):
    data=copy.deepcopy(fixtures)
    if label=='harmless':data['verify_original'][1]['Config']['Labels']['reviewerNote']='Unrelated'
    for name,args in data.items():getattr(s,name)(*args)
    for kind,info in snapshots.items():s.verify_original(kind,info)
    records.append({'case':label,'passed':True})
for name,reason,change in variants:
    args=copy.deepcopy(fixtures[name]);change(args)
    try:getattr(s,name)(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken scope survived: '+reason)
    tree=ast.parse(source.read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    class Omit(ast.NodeTransformer):
        def visit_Expr(self,node):
            call=node.value
            if isinstance(call,ast.Call) and len(call.args)==2 and isinstance(call.args[1],ast.Constant) and call.args[1].value==reason:return None
            return self.generic_visit(node)
    Omit().visit(fn)
    space={};exec(compile(tree,str(source),'exec'),space)
    try:space[name](*args);raise AssertionError('Broken scope survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken scope survived: '+reason
    records.append({'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
(p/'scope-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure extracted guards, protected retained configuration and copied fixtures. No native services, database or root writes.'},indent=2)+'\n')
print('3 positive, 28 broken scopes and 28 omitted-guard oracles pass.')
