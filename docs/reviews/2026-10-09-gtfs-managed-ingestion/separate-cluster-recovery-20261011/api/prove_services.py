"""Pure created-service guards, with copied protected source metadata."""
import ast,copy,hashlib,json
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import services as s
from scope import DB_NAME

p=Path(__file__).parent;source=p/'services.py';snapshots=json.loads((p/'source-services-private.json').read_text());database='openplan_attempt_cli_'+'b'*32;storage=Path('/private/copied-storage');configuration=Path('/private/copied-kong.json')
fixtures={}
for kind,old in snapshots.items():
    info=copy.deepcopy(old);name='openplan-gtfs-point-source-'+kind+'-synthetic';info.update(Id='created-'+kind,Name='/'+name)
    info['NetworkSettings']['Networks']={s.NETWORK:{}}
    info['Config']['Labels'].update({'openplan.purpose':s.PURPOSE,'openplan.proof.stage':'source'})
    env=dict(row.split('=',1) for row in info['Config']['Env'] if '=' in row)
    if kind!='gateway':
        uri=urlsplit(env[s.URI_KEYS[kind]])
        env[s.URI_KEYS[kind]]=urlunsplit(uri._replace(netloc=uri.netloc.rsplit('@',1)[0]+'@'+DB_NAME+':'+str(uri.port or 5432),path='/'+database))
    if kind=='rest':env['PGRST_OPENAPI_MODE']='disabled'
    info['Config']['Env']=[k+'='+v for k,v in env.items()]
    info['HostConfig'].update(Memory=s.LIMITS[kind],MemorySwap=s.LIMITS[kind],NanoCpus=500000000,PidsLimit=128)
    info['HostConfig']['PortBindings']={str(s.PORTS[kind])+'/tcp':[{'HostIp':'127.74.9.11','HostPort':'29941' if kind=='gateway' else ''}]}
    info['Mounts']=[] if kind in ('rest','auth') else [{'Type':'bind','Source':str(storage if kind=='storage' else configuration),'Destination':'/mnt' if kind=='storage' else '/etc/kong/proof.json','RW':kind=='storage'}]
    receipt={'name':name,'stage':'source','id':info['Id'],'environmentSha256':s.environment_hash(env)}
    fixtures[kind]=[kind,info,receipt,database,storage,configuration]

def rehash(args):args[2]['environmentSha256']=s.environment_hash(dict(row.split('=',1) for row in args[1]['Config']['Env'] if '=' in row))
def change_uri(args):
    env=dict(row.split('=',1) for row in args[1]['Config']['Env'] if '=' in row);env[s.URI_KEYS[args[0]]]='postgres://foreign/foreign';args[1]['Config']['Env']=[k+'='+v for k,v in env.items()];rehash(args)
def openapi(args):
    args[1]['Config']['Env']=[row for row in args[1]['Config']['Env'] if not row.startswith('PGRST_OPENAPI_MODE=')];rehash(args)
variants=[
 ('storage','expanded-new-identity',lambda a:a[1].update(Id='foreign')),
 ('storage','expanded-new-identity',lambda a:a[1].update(Name='/foreign')),
 ('storage','expanded-new-identity',lambda a:a[1].update(Image='foreign')),
 ('storage','expanded-new-owner',lambda a:a[1]['Config']['Labels'].update({'openplan.proof.stage':'foreign'})),
 ('storage','expanded-new-network',lambda a:a[1]['NetworkSettings']['Networks'].update(foreign={})),
 ('storage','expanded-new-limits',lambda a:a[1]['HostConfig'].update(MemorySwap=-1)),
 ('storage','expanded-new-limits',lambda a:a[1]['HostConfig'].update(PidsLimit=0)),
 ('storage','expanded-new-environment',lambda a:a[2].update(environmentSha256='0'*64)),
 ('storage','expanded-new-uri',change_uri),
 ('rest','expanded-new-openapi',openapi),
 ('storage','expanded-new-loopback',lambda a:a[1]['HostConfig']['PortBindings']['5000/tcp'][0].update(HostIp='0.0.0.0')),
 ('gateway','expanded-new-loopback',lambda a:a[1]['HostConfig']['PortBindings']['8000/tcp'][0].update(HostPort='3000')),
 ('storage','expanded-new-mounts',lambda a:a[1]['Mounts'][0].update(Source='/foreign')),
 ('gateway','expanded-new-mounts',lambda a:a[1]['Mounts'][0].update(RW=True)),
]
records=[]
for label in ('baseline','harmless','restored','owned-stopped'):
    for args in copy.deepcopy(fixtures).values():
        if label=='harmless':args[1]['Config']['Labels']['reviewerNote']='Unrelated'
        if label=='owned-stopped':args[1]['State']['Running']=False
        s.verify_new(*args)
    records.append({'case':label,'passed':True})
tree=ast.parse(source.read_text());nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('environment_hash','verify_new')]
for kind,reason,change in variants:
    args=copy.deepcopy(fixtures[kind]);change(args)
    try:s.verify_new(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken created service survived: '+reason)
    mutated=copy.deepcopy(nodes)
    class Omit(ast.NodeTransformer):
        def visit_Expr(self,node):
            v=node.value
            if isinstance(v,ast.Call) and len(v.args)==2 and isinstance(v.args[1],ast.Constant) and v.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
            return self.generic_visit(node)
    Omit().visit(mutated[1])
    space={k:getattr(s,k) for k in ('require','json','hashlib','urlsplit','IMAGES','PURPOSE','NETWORK','LIMITS','URI_KEYS','DB_NAME','PORTS')}
    exec(compile(ast.Module(body=mutated,type_ignores=[]),str(source),'exec'),space)
    try:space['verify_new'](*args);raise AssertionError('Broken created service survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken created service survived: '+reason
    records.append({'kind':kind,'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
source.with_name('service-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Copied protected metadata and in-memory guard mutations. No Docker, network, database, source files or services changed.'},indent=2)+'\n')
print('4 positive, 14 broken created-service cases and 14 omitted-guard oracles pass.')
