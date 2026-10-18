"""No Docker, SQL, network, subprocesses, or production-file mutation."""
import copy
import json
import policy as p


def run():
    rows = []
    cases = [
        ('database', p.database, dict(Id=p.DB_ID, Name='/' + p.DB_NAME, Image=p.DB_IMAGE,
          running=True, project='openplan-restore-target-2026091050', networkId=p.NETWORK_ID)),
        ('source', p.source, dict(database=p.SOURCE, readonly='on', historyCount=419,
          latest='20261017000016', foreignTables=0, subscriptions=0, cron=False,
          databaseSettings=0, delegatedGrantors=0)),
    ]
    expected_service = dict(id='a'*64, name='combined-rest', image=p.IMAGES['rest'],
        labels={'openplan.purpose':p.PURPOSE}, network=[p.NETWORK_ID], networkNames=[p.NETWORK], memory=p.LIMIT,
        swap=p.LIMIT, cpus=500000000, pids=128, environment='hash', mounts=[],
        bindings={'8000/tcp':[{'HostIp':p.HOST,'HostPort':'29948'}]},
        database='openplan_project_combined_preview_'+'a'*24, running=True,
        privileged=False, networkMode=p.NETWORK, extraHosts=None, capAdd=None,
        pidMode='', binds=None, readOnlyRoot=False)
    launch = dict(head=p.HEAD, clean=True, app=p.ROOT+'/candidate/openplan', build='synthetic',
        buildHash='hash', envHash='hash', sourceHash='hash', receiptHash='hash',
        api=p.API, web=p.WEB, disabledGTFS=True, absentAI=True, freePort=True,
        services=True, noOom=True, bounded=True)
    # These scopes exercise the common typed comparator used by each acquisition gate.
    scoped={
        'source-fingerprint':{'sha256':'a'*64},
        'prior-input':{'sha256':'b'*64},'prior-helper':{'sha256':'c'*64},
        'properties':dict(owner='postgres',encoding='UTF8',collate='en_US.UTF-8',ctype='en_US.UTF-8',localeProvider='i',connectionLimit=-1),
        'old-helper':dict(Id='a'*64,Image=p.IMAGES['rest']),
        'helper-uri':dict(host=p.DB_NAME,port=5432,role='authenticator',query='',hasPassword=True),
        'kong-upstream':{'host':'owned-source-storage'},
        'plan':dict(head=p.HEAD,source=p.SOURCE,dbId=p.DB_ID,api=p.API,web=p.WEB,root=p.ROOT),
        'clone':dict(fresh=True,disk=True),
        'dump-bytes':{'sha256':'a'*64},'dump':{'ok':True},'restore':{'returncode':0},
        'restored-data':{'data':[{'table':'auth.users','count':15,'digest':'fixture'}]},
        'target-identity':dict(oid=12345,database='openplan_project_combined_preview_'+'a'*24,owner='postgres'),
        'clone-ready':{'target':'openplan_project_combined_preview_'+'a'*24},
        'helpers':{'kinds':sorted(p.IMAGES)},
        'receipt':dict(name='owned',database='openplan_project_combined_preview_'+'a'*24),
        'health':dict(auth=200,rest=200,storage=200,ownOrigin=p.WEB,oldOrigin=None),
        'checkout':{'head':p.HEAD},'app-env':dict(sha256='a'*64,otherEnv=[]),
        'app':dict(head=p.HEAD,clean=True,path=p.ROOT+'/candidate/openplan'),
        'app-values':dict(api=p.API,web=p.WEB,head=p.HEAD,gtfs='0',values={'fixture':'only'}),
        'build-budget':{'memory.max':str(10*1024**3),'memory.swap.max':'0'},
        'build-headroom':dict(memory=True,disk=True),
        'build':{'returncode':0},'launcher-root':{'root':p.ROOT},
        'candidate-migrations':{'versions':['20261017000016']},
        'app-env-binding':{'sha256':'a'*64},
    }
    for scope,expected in scoped.items():
        cases.append((scope,lambda x,e=expected,n=scope:p.exact(e,x,n),expected))
    cases += [('service', lambda x:p.service(expected_service,x), expected_service),
              ('launch', lambda x:p.launch(launch,x), launch),
              ('files', lambda x:p.files({'a':'a'*64},x), {'a':'a'*64})]
    for name, check, original in cases:
        baseline = copy.deepcopy(original)
        check(baseline)
        # Prove that an ignored note can survive before counting any refusals.
        if name != 'files':
            check({**baseline,'note':'Harmless wording change'})
            rows.append(dict(control=name+':harmless-note', outcome='survived'))
        else:
            check(dict(reversed(list(baseline.items()))))
            rows.append(dict(control='files:harmless-order',outcome='survived'))
        for key in baseline:
            for kind in ['wrong','missing','wrong-type']:
                broken=copy.deepcopy(baseline)
                if kind=='missing': del broken[key]
                elif kind=='wrong-type': broken[key]=True if broken[key] is None else None
                elif type(broken[key]) is bool: broken[key]=not broken[key]
                elif type(broken[key]) is int: broken[key]+=1
                elif isinstance(broken[key],dict): broken[key]={**broken[key],'fault':True}
                elif isinstance(broken[key],list): broken[key].append('foreign')
                else: broken[key]='foreign'
                reason=name+':'+key
                try: check(broken)
                except ValueError as e:
                    if str(e)!=reason: raise AssertionError((reason,str(e)))
                    rows.append(dict(control=reason+':'+kind,outcome='intended_refusal',reason=str(e)))
                else: raise AssertionError('survived: '+reason)
        check(copy.deepcopy(baseline))
        assert original==baseline
        rows.append(dict(control=name+':exact-restoration',outcome='survived'))
    target='openplan_project_combined_preview_'+'a'*24
    for bad in [p.SOURCE, 'openplan_attempt_cli_'+'a'*32, target+'x', '', None]:
        try:p.target_name(bad)
        except ValueError as e:rows.append(dict(control='target:foreign-or-malformed',outcome='intended_refusal',reason=str(e)))
        else:raise AssertionError('foreign target survived')
    p.target_name(target)
    cmd=['docker','exec','-i',p.DB_ID,'pg_restore','-U','supabase_admin','-d',target,'--jobs=1','--exit-on-error','--single-transaction']
    p.safe_parent_command(cmd,target)
    for label, index, value in [('source-as-restore-target',8,p.SOURCE),('foreign-container',3,'b'*64),('parallel-restore',9,'--jobs=4'),('ignore-restore-errors',10,'--clean')]:
        broken=cmd.copy();broken[index]=value
        try:p.safe_parent_command(broken,target)
        except ValueError as e:rows.append(dict(control=label,outcome='intended_refusal',reason=str(e)))
        else:raise AssertionError(label)
    p.safe_parent_command(cmd,target)
    try:p.files({'a':'a'*64},{'a':'a'*64,'foreign':'hash'})
    except ValueError as e:
        assert str(e)=='file-set:keys'
        rows.append(dict(control='extra-file',outcome='intended_refusal',reason=str(e)))
    else:raise AssertionError('extra file')
    cmd=p.source_dump_args();p.dump_command(cmd)
    for index in range(len(cmd)):
        broken=cmd.copy();broken[index]='foreign-or-write-mode'
        try:p.dump_command(broken)
        except ValueError as e:
            assert str(e)=='source-dump:argv'
            rows.append(dict(control='source-dump-argument-'+str(index),outcome='intended_refusal',reason=str(e)))
        else:raise AssertionError('source dump argument survived')
    p.dump_command(cmd)
    rows.append(dict(control='source-dump-exact-restoration',outcome='survived'))
    rows.extend(acquisition_controls())
    return {'scope':'Synthetic in-memory checks only; no acquisition, Docker, DB, build or browser proof.', 'controls':rows}


def acquisition_controls():
    """Exercise raw Docker observation mapping with all tool calls replaced."""
    import launcher as l
    from unittest.mock import patch
    receipt=dict(id='a'*64,name='owned',database='openplan_project_combined_preview_'+'a'*24,
        labels={'openplan.purpose':p.PURPOSE,'openplan.candidate':p.HEAD})
    env={'PGRST_DB_URI':'postgresql://authenticator:synthetic@'+p.DB_NAME+'/'+receipt['database']}
    raw=dict(Id=receipt['id'],Name='/owned',Image=p.IMAGES['rest'],State={'Running':True},
        Config={'Env':[k+'='+v for k,v in env.items()],'Labels':receipt['labels']},
        NetworkSettings={'Networks':{p.NETWORK:{'NetworkID':p.NETWORK_ID}}},Mounts=[],
        HostConfig=dict(Memory=p.LIMIT,MemorySwap=p.LIMIT,NanoCpus=500000000,PidsLimit=128,
            PortBindings={},Privileged=False,NetworkMode=p.NETWORK,ExtraHosts=None,
            CapAdd=None,PidMode='',Binds=None,ReadonlyRootfs=False))
    rows=[]
    image=[{'Config':{'Env':[],'Labels':None}}]
    with patch.object(l,'inspect',return_value=raw),patch.object(l,'run',return_value=json.dumps(image).encode()):
        expected=l.expected_service('rest',receipt,env)
        p.service(expected,l.observed_service('rest',receipt))
        rows.append(dict(control='raw-docker-baseline',outcome='survived'))
        harmless=copy.deepcopy(raw);harmless['note']='Harmless inspect note'
        with patch.object(l,'inspect',return_value=harmless):p.service(expected,l.observed_service('rest',receipt))
        rows.append(dict(control='raw-docker-harmless',outcome='survived'))
        mutations=[
            ('id',lambda x:x.update(Id='b'*64)),
            ('name',lambda x:x.update(Name='/foreign')),
            ('image',lambda x:x.update(Image='foreign')),
            ('labels',lambda x:x['Config']['Labels'].update({'openplan.purpose':'foreign'})),
            ('network',lambda x:x['NetworkSettings']['Networks'][p.NETWORK].update(NetworkID='foreign')),
            ('memory',lambda x:x['HostConfig'].update(Memory=0)),
            ('swap',lambda x:x['HostConfig'].update(MemorySwap=-1)),
            ('cpus',lambda x:x['HostConfig'].update(NanoCpus=0)),
            ('pids',lambda x:x['HostConfig'].update(PidsLimit=0)),
            ('environment',lambda x:x['Config']['Env'].append('OPENAI_API_KEY=synthetic')),
            ('mounts',lambda x:x['Mounts'].append({'Source':'/foreign','Destination':'/mnt','RW':True})),
            ('bindings',lambda x:x['HostConfig'].update(PortBindings={'3000/tcp':[{'HostIp':'0.0.0.0','HostPort':'29948'}]})),
            ('running',lambda x:x['State'].update(Running=False)),
            ('privileged',lambda x:x['HostConfig'].update(Privileged=True)),
            ('networkMode',lambda x:x['HostConfig'].update(NetworkMode='host')),
            ('extraHosts',lambda x:x['HostConfig'].update(ExtraHosts=['foreign'])),
            ('capAdd',lambda x:x['HostConfig'].update(CapAdd=['ALL'])),
            ('pidMode',lambda x:x['HostConfig'].update(PidMode='host')),
            ('binds',lambda x:x['HostConfig'].update(Binds=['/foreign:/mnt'])),
            ('readOnlyRoot',lambda x:x['HostConfig'].update(ReadonlyRootfs=True)),
        ]
        for field,mutate in mutations:
            broken=copy.deepcopy(raw);mutate(broken)
            with patch.object(l,'inspect',return_value=broken):
                try:p.service(expected,l.observed_service('rest',receipt))
                except ValueError as e:
                    assert str(e)=='service:'+field
                    rows.append(dict(control='raw-docker-'+field,outcome='intended_refusal',reason=str(e)))
                else:raise AssertionError('raw observation survived: '+field)
        p.service(expected,l.observed_service('rest',receipt))
        created={**l.observed_service('rest',receipt),'running':False,'network':['']}
        p.created_service(expected,created)
        rows.append(dict(control='created-service-unassigned-network',outcome='survived'))
        p.created_service(expected,{**created,'note':'Harmless inspect note'})
        rows.append(dict(control='created-service-harmless-note',outcome='survived'))
        for field,value,reason in [('network',['foreign'],'created-service:networkIdValid'),('networkNames',['foreign'],'service:networkNames'),('running',True,'service:running')]:
            try:p.created_service(expected,{**created,field:value})
            except ValueError as error:
                assert str(error)==reason
                rows.append(dict(control='created-service-'+field,outcome='intended_refusal',reason=str(error)))
            else:raise AssertionError(field)
        p.created_service(expected,created)
        rows.append(dict(control='created-service-exact-restoration',outcome='survived'))
        rows.append(dict(control='raw-docker-exact-restoration',outcome='survived'))
    rows.extend(configuration_controls())
    return rows


def configuration_controls():
    from urllib.parse import urlencode
    plan={'target':'openplan_project_combined_preview_'+'a'*24,'names':{kind:'owned-'+kind for kind in p.IMAGES}}
    envs={kind:{} for kind in p.IMAGES}
    for kind,key in p.URI_KEYS.items():
        envs[kind][key]='postgresql://'+p.ROLES[kind]+':synthetic@'+p.DB_NAME+':5432/'+plan['target']+'?'+urlencode({'options':'-c search_path='+('auth,public,extensions' if kind=='auth' else 'storage,public,extensions' if kind=='storage' else 'public,extensions')})
    envs['rest'].update(PGRST_JWT_SECRET='s'*64,PGRST_DB_CONFIG='false',PGRST_OPENAPI_MODE='disabled',PGRST_DB_POOL='2')
    envs['auth'].update(GOTRUE_JWT_SECRET='s'*64,GOTRUE_SITE_URL=p.WEB,GOTRUE_URI_ALLOW_LIST=p.WEB+'/**',API_EXTERNAL_URL=p.API,GOTRUE_JWT_ISSUER=p.API+'/auth/v1',GOTRUE_DISABLE_SIGNUP='true',GOTRUE_MAILER_AUTOCONFIRM='true',GOTRUE_DB_MAX_POOL_SIZE='3')
    envs['storage'].update(AUTH_JWT_SECRET='s'*64,ANON_KEY='synthetic-anon',SERVICE_KEY='synthetic-service',STORAGE_BACKEND='file',FILE_STORAGE_BACKEND_PATH='/mnt',S3_PROTOCOL_ENABLED='false',VECTOR_ENABLED='false',ENABLE_IMAGE_TRANSFORMATION='false',DB_POOL_MAX='3')
    app=dict(NEXT_PUBLIC_SUPABASE_URL=p.API,NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-anon',SUPABASE_SERVICE_ROLE_KEY='synthetic-service',NEXT_PUBLIC_APP_URL=p.WEB,OPENPLAN_COMMIT_SHA=p.HEAD,OPENPLAN_GTFS_MANAGED_INGESTION='0',OPENPLAN_GTFS_PARSER_BUILD=p.HEAD)
    urls={kind:'http://owned-'+kind+':'+str(p.PORTS[kind])+'/' for kind in ['rest','auth','storage']}
    urls['storage-signed-read']='http://owned-storage:5000/object/sign/'
    kong={'plugins':[{'name':'cors','config':{'origins':[p.WEB]}}],'services':[{'name':k,'url':v} for k,v in urls.items()]}
    original=copy.deepcopy((plan,envs,kong,app))
    p.configuration(plan,envs,kong,app)
    rows=[dict(control='configuration-baseline',outcome='survived')]
    # Mutate actual input acquisition, then require the precise named refusal.
    faults=[
        ('endpoints',lambda e,k,a:e['rest'].update(PGRST_DB_URI='postgresql://authenticator:synthetic@'+p.DB_NAME+'/'+p.SOURCE)),
        ('jwtShared',lambda e,k,a:e['auth'].update(GOTRUE_JWT_SECRET='different')),
        ('appKeysMatch',lambda e,k,a:a.update(SUPABASE_SERVICE_ROLE_KEY='different')),
        ('rest',lambda e,k,a:e['rest'].update(PGRST_DB_CONFIG='true')),
        ('auth',lambda e,k,a:e['auth'].update(GOTRUE_SITE_URL='http://127.74.15.10:3583')),
        ('mailAbsent',lambda e,k,a:e['auth'].update(GOTRUE_SMTP_HOST='smtp.synthetic.invalid')),
        ('cloudAbsent',lambda e,k,a:e['storage'].update(OPENAI_API_KEY='synthetic')),
        ('storage',lambda e,k,a:e['storage'].update(STORAGE_BACKEND='s3')),
        ('cors',lambda e,k,a:k['plugins'][0]['config'].update(origins=['http://127.74.15.10:3583'])),
        ('upstreams',lambda e,k,a:k['services'][0].update(url='http://prior-helper:3000/')),
        ('appSet',lambda e,k,a:a.update(CENSUS_API_KEY='synthetic')),
        ('appOrigin',lambda e,k,a:a.update(NEXT_PUBLIC_SUPABASE_URL='https://synthetic.invalid')),
        ('webOrigin',lambda e,k,a:a.update(NEXT_PUBLIC_APP_URL='http://127.74.15.10:3583')),
        ('appHead',lambda e,k,a:a.update(OPENPLAN_COMMIT_SHA='foreign')),
        ('gtfs',lambda e,k,a:a.update(OPENPLAN_GTFS_MANAGED_INGESTION='1')),
    ]
    for name,mutate in faults:
        _,e,k,a=copy.deepcopy(original);mutate(e,k,a)
        try:p.configuration(plan,e,k,a)
        except ValueError as error:
            assert str(error)=='configuration:'+name
            rows.append(dict(control='configuration-'+name,outcome='intended_refusal',reason=str(error)))
        else:raise AssertionError('configuration survived '+name)
    assert original==(plan,envs,kong,app)
    p.configuration(plan,envs,kong,app)
    rows.append(dict(control='configuration-exact-restoration',outcome='survived'))
    return rows


if __name__=='__main__':print(json.dumps(run(),indent=2))
