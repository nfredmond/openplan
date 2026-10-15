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
        # The health rows now exercise the operational policy, not the former
        # None-only comparator. Their serialized labels alone do not show this.
        cases.append((scope,p.health if scope=='health' else lambda x,e=expected,n=scope:p.exact(e,x,n),expected))
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
    rows.extend(health_acquisition_controls())
    return {'scope':'Synthetic acquisition with HTTP/tool boundaries replaced; no live Docker, DB, HTTP, build or browser proof.', 'controls':rows}


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
    rows.extend(optional_controls(plan,envs,kong,app))
    return rows


def optional_controls(plan, envs, kong, base_app):
    """Exercise the new source reader and guards with synthetic bytes only."""
    import hashlib
    import launcher as l
    from unittest.mock import patch
    values={key:'synthetic-'+key.lower() for key in sorted(p.OPTIONAL_KEYS)}
    data=('\n'.join(key+'='+json.dumps(value) for key,value in values.items())+'\n').encode()
    binding=dict(path=p.CONFIG_SOURCE,sha256=hashlib.sha256(data).hexdigest(),values=values)
    app={**base_app,**values}
    rows=[]
    def survives(label,check):
        check();rows.append(dict(control=label,outcome='survived'))
    def refuses(label,reason,check):
        try:check()
        except ValueError as error:
            assert str(error)==reason,(label,str(error),reason)
            rows.append(dict(control=label,outcome='intended_refusal',reason=str(error)))
        else:raise AssertionError('survived: '+label)
    def bound(data_value=data,source=binding,app_value=app):
        return p.configured_source(source,data_value,app_value)
    survives('optional-source-harmless-binding-note',lambda:bound(source={**binding,'note':'Harmless wording'}))
    survives('optional-configured-baseline',lambda:p.configuration(plan,envs,kong,app,values))
    survives('optional-source-harmless-app-order',lambda:bound(app_value=dict(reversed(list(app.items())))))
    # Equivalent formatting may survive only when explicitly bound to its own bytes.
    formatted=('\n'.join(' export '+key+"='"+value+"'" for key,value in reversed(list(values.items())))+'\n# harmless note\n').encode()
    survives('optional-parser-format-survivor',lambda:bound(formatted,{**binding,'sha256':hashlib.sha256(formatted).hexdigest()}))
    refuses('optional-source-changed-hash','optional-source-hash:sha256',lambda:bound(data+b'# changed source\n'))
    refuses('optional-source-wrong-path','optional-source:path',lambda:bound(source={**binding,'path':'/foreign/.env.local'}))
    refuses('optional-binding-wrong-source-hash','optional-source-hash:sha256',lambda:bound(source={**binding,'sha256':'0'*64}))
    for key in sorted(values):
        omitted={k:v for k,v in values.items() if k!=key}
        missing_app={k:v for k,v in app.items() if k!=key}
        refuses('optional-app-omission-'+key,'optional-app:values',lambda a=missing_app:bound(app_value=a))
        refuses('optional-app-mismatch-'+key,'optional-app:values',lambda k=key:bound(app_value={**app,k:'different'}))
        refuses('optional-binding-omission-'+key,'optional-source-values:values',lambda v=omitted:bound(source={**binding,'values':v}))
        missing_data=('\n'.join(k+'='+json.dumps(v) for k,v in omitted.items())+'\n').encode()
        refuses('optional-source-omission-'+key,'optional-source-values:values',lambda d=missing_data:bound(d,{**binding,'sha256':hashlib.sha256(d).hexdigest()}))
        refuses('optional-config-omission-'+key,'configuration:appSet',lambda a=missing_app:p.configuration(plan,envs,kong,a,values))
        refuses('optional-config-mismatch-'+key,'optional-app:values',lambda k=key:p.configuration(plan,envs,kong,{**app,k:'different'},values))
        e=copy.deepcopy(envs);e['rest'][key]='synthetic'
        refuses('optional-helper-leak-'+key,'configuration:optionalHelpersAbsent',lambda e=e:p.configuration(plan,e,kong,app,values))
        for value,label in [('', 'empty'),(None,'null'),(17,'number'),('unsafe\nline','newline'),('$EXPAND','expansion')]:
            refuses('optional-value-'+key+'-'+label,'optional-values:valid',lambda k=key,v=value:p.optional_values({**values,k:v}))
        duplicate=data+(key+'="duplicate"\n').encode()
        refuses('optional-duplicate-'+key,'optional-source:unique',lambda d=duplicate:p.selected_values(d))
    for key in ['OPENAI_API_KEY','ANTHROPIC_API_KEY','RESEND_API_KEY','UNAUTHORIZED_PROVIDER_KEY']:
        refuses('optional-allowlist-extra-'+key,'optional-allowlist:allowed',lambda k=key:p.optional_values({**values,k:'synthetic'}))
        reason='configuration:cloudAbsent' if key!='UNAUTHORIZED_PROVIDER_KEY' else 'configuration:appSet'
        refuses('optional-app-secret-absence-'+key,reason,lambda k=key:p.configuration(plan,envs,kong,{**app,k:'synthetic'},values))
    for value,label in [('"unfinished','double-quote'),("'unfinished",'single-quote'),("'embedded'quote'",'embedded-quote')]:
        refuses('optional-source-syntax-'+label,'optional-source:syntax',lambda v=value:p.selected_values(('CENSUS_API_KEY='+v).encode()))
    # Absence is valid only when the source itself lacked each optional key.
    for absent in [set(values),{'OPENPLAN_INTEGRATION_KEY_SECRET'}]:
        v={k:x for k,x in values.items() if k not in absent};a={**base_app,**v}
        d=('\n'.join(k+'='+json.dumps(x) for k,x in v.items())+'\n').encode()
        b={**binding,'sha256':hashlib.sha256(d).hexdigest(),'values':v}
        survives('optional-source-absent-survivor-'+str(len(absent)),lambda d=d,b=b,a=a:bound(d,b,a))
        survives('optional-config-absent-survivor-'+str(len(absent)),lambda v=v,a=a:p.configuration(plan,envs,kong,a,v))
        refuses('optional-unbound-secret-injection-'+str(len(absent)),'optional-app:values',lambda d=d,b=b,a=a:bound(d,b,{**a,'OPENPLAN_INTEGRATION_KEY_SECRET':'invented'}))
    synthetic=[{'table':'synthetic.fixture','digest':'untouched'}]
    assert p.SOURCE_ANCHOR=='82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547'
    with patch.object(p,'SOURCE_ANCHOR',p.digest(synthetic)):
        frozen={'sha256':p.SOURCE_ANCHOR}
        survives('source-anchor-harmless-note',lambda:p.source_fingerprint({**frozen,'note':'Harmless'},synthetic))
        refuses('source-anchor-rebaseline','source-anchor:sha256',lambda:p.source_fingerprint({'sha256':'0'*64},synthetic))
        refuses('source-anchor-current-changed','source-fingerprint:sha256',lambda:p.source_fingerprint(frozen,synthetic+[{'fault':True}]))
        survives('source-anchor-exact-restoration',lambda:p.source_fingerprint(frozen,synthetic))
        source_info=dict(database=p.SOURCE,readonly='on',historyCount=419,latest='20261017000016',
            foreignTables=0,subscriptions=0,cron=False,databaseSettings=0,delegatedGrantors=0)
        current=[source_info,*synthetic]
        with patch.object(p,'SOURCE_ANCHOR',p.digest(current)),patch.object(l,'db_check'),patch.object(l,'snapshot',return_value=current),patch.object(l,'read',return_value={'sha256':p.digest(current)}):
            survives('source-check-reader-baseline',lambda:l.source_check())
            with patch.object(l,'snapshot',return_value=[source_info,{'fault':True}]):
                refuses('source-check-reader-changed','source-fingerprint:sha256',lambda:l.source_check())
            with patch.object(l,'read',return_value={'sha256':'0'*64}):
                refuses('source-check-reader-rebaseline','source-anchor:sha256',lambda:l.source_check())
            survives('source-check-reader-restoration',lambda:l.source_check())
    class SyntheticPath:
        mode=0o100600
        regular=True
        symlink=False
        def is_file(self):return self.regular
        def is_symlink(self):return self.symlink
        def stat(self):return type('Stat',(),{'st_mode':self.mode})()
        def read_bytes(self):return data
    path=SyntheticPath()
    with patch.object(l,'Path',return_value=path) as constructor,patch.object(l,'read',return_value=binding):
        survives('optional-source-reader-baseline',lambda:l.configured_source(app))
        constructor.assert_called_with(p.CONFIG_SOURCE)
        for field,value,reason in [('mode',0o100644,'optional-source-file:private'),('regular',False,'optional-source-file:regular'),('symlink',True,'optional-source-file:regular')]:
            original=getattr(path,field);setattr(path,field,value)
            refuses('optional-source-reader-'+field,reason,lambda:l.configured_source(app))
            setattr(path,field,original)
        survives('optional-source-reader-restoration',lambda:l.configured_source(app))
    # Exercise the real pinned_files call path, replacing only filesystem inputs.
    configured_plan={**plan,'head':p.HEAD,'source':p.SOURCE,'dbId':p.DB_ID,'api':p.API,'web':p.WEB,'root':p.ROOT}
    fixture={'private-bindings.json':{'configured-source-private.json':'hash','app-env-private.json':'hash'},
        'plan-private.json':configured_plan,'configured-source-private.json':binding,
        'app-env-private.json':app,'envs-private.json':envs,'kong-private.json':kong}
    with patch.object(l,'templates'),patch.object(l,'Path',return_value=path),patch.object(l,'sha',return_value='hash'),patch.object(l,'read',side_effect=lambda name:fixture[name]):
        survives('optional-pinned-reader-baseline',lambda:l.pinned_files())
        with patch.object(path,'read_bytes',return_value=data+b'# changed source\n'):
            refuses('optional-pinned-source-hash','optional-source-hash:sha256',lambda:l.pinned_files())
        with patch.object(l,'sha',side_effect=lambda file:'changed' if file.name=='configured-source-private.json' else 'hash'):
            refuses('optional-pinned-manifest-hash','files:configured-source-private.json',lambda:l.pinned_files())
        for key in sorted(values):
            fixture['app-env-private.json']={k:v for k,v in app.items() if k!=key}
            refuses('optional-pinned-omission-'+key,'optional-app:values',lambda:l.pinned_files())
            fixture['app-env-private.json']={**app,key:'different'}
            refuses('optional-pinned-mismatch-'+key,'optional-app:values',lambda:l.pinned_files())
            fixture['app-env-private.json']=app
        fixture['app-env-private.json']={**app,'OPENAI_API_KEY':'synthetic'}
        refuses('optional-pinned-forbidden-secret','configuration:cloudAbsent',lambda:l.pinned_files())
        fixture['app-env-private.json']=app
        survives('optional-pinned-reader-restoration',lambda:l.pinned_files())
    survives('optional-source-exact-restoration',lambda:bound())
    survives('optional-config-exact-restoration',lambda:p.configuration(plan,envs,kong,app,values))
    return rows


class HealthControlFailure(AssertionError):
    """A named health expectation failed; unrelated runtime errors are not kills."""


def health_acquisition_controls():
    """Call real health/verify_services; replace file and HTTP acquisition only."""
    import launcher as l
    from unittest.mock import patch, call
    from email.message import Message
    rows=[]
    old='http://127.74.15.10:3583'
    specs=[('GET','/auth/v1/health',None),
        ('HEAD','/rest/v1/projects?select=id&limit=0',None),
        ('GET','/storage/v1/status',None),
        ('OPTIONS','/rest/v1/projects',p.WEB),
        ('OPTIONS','/rest/v1/projects',old)]
    baseline=[(200,None),(200,None),(200,None),(200,p.WEB),(200,p.WEB)]

    def fail(label,reason):
        raise HealthControlFailure('health-control:'+label+':'+reason)

    def probe(label,responses=None,reason=None,extra_header=False,entry=None):
        responses=baseline if responses is None else responses
        calls=[];entered=[];exited=[];builders=[]
        class Response:
            def __init__(self,index):
                self.index=index;self.status,origin=responses[index]
                self.headers=Message()
                if origin is not None:self.headers['Access-Control-Allow-Origin']=origin
                if extra_header:self.headers['X-Harmless-Note']='wording only'
            def __enter__(self):entered.append(self.index);return self
            def __exit__(self,*args):exited.append(self.index)
        class Opener:
            def open(self,request,timeout):
                # Assert actual Request acquisition, not a supplied observed dict.
                headers={key.lower():value for key,value in request.header_items()}
                call=(request.get_method(),request.full_url,headers,timeout)
                index=len(calls);calls.append(call)
                if index>=len(specs):fail(label,'extra-request')
                method,path,origin=specs[index]
                wanted={'apikey':'synthetic-service','authorization':'Bearer synthetic-service'} if origin is None else {
                    'origin':origin,'access-control-request-method':'GET',
                    'access-control-request-headers':'apikey,authorization'}
                if call!=(method,p.API+path,wanted,5):fail(label,'request-'+str(index))
                return Response(index)
        def build(*handlers):
            builders.append(handlers)
            if len(handlers)!=2 or not isinstance(handlers[0],l.urllib.request.ProxyHandler) or handlers[0].proxies!={}:fail(label,'proxy')
            if handlers[1].redirect_request(None,None,302,'',{},p.API+'/other') is not None:fail(label,'redirect')
            return Opener()
        with patch.object(l,'read',return_value={'SUPABASE_SERVICE_ROLE_KEY':'synthetic-service'}) as reader,patch.object(l.urllib.request,'build_opener',side_effect=build):
            try:(l.health if entry is None else entry)()
            except ValueError as error:
                if str(error)!=reason:fail(label,'unexpected-refusal:'+str(error))
            else:
                if reason is not None:fail(label,'expected-refusal:'+reason)
            if len(builders)!=1 or len(calls)!=5 or entered!=list(range(5)) or exited!=list(range(5)):fail(label,'requests-not-acquired')
            # The integration probe also reads service receipts and environment.
            if entry is None and reader.call_args_list!=[call('app-env-private.json')]:fail(label,'app-env-read')
        rows.append(dict(control='health-http:'+label,outcome='survived' if reason is None else 'intended_refusal',**({} if reason is None else {'reason':reason})))

    probe('baseline-fixed-configured')
    probe('harmless-response-header',extra_header=True)
    absent=baseline.copy();absent[4]=(200,None)
    probe('old-header-absent',absent)
    for index,label in enumerate(['auth','rest','storage']):
        for status in [201,204,503,'200',None,True]:
            broken=baseline.copy();broken[index]=(status,None)
            probe(label+'-status-'+repr(status),broken,'health:'+label)
    for origin,label in [(None,'absent'),(old,'old'),('*','wildcard'),('http://unrecognized.invalid','unrecognized'),(p.WEB+'/','trailing-slash'),('null','null'),('','empty'),(p.WEB+', '+old,'origin-list')]:
        broken=baseline.copy();broken[3]=(200,origin)
        probe('own-header-'+label,broken,'health:ownOrigin')
    for origin,label in [(old,'reflected'),('*','wildcard'),('http://unrecognized.invalid','unrecognized'),(p.WEB+'/','trailing-slash'),('null','null'),('','empty'),(p.WEB+', '+old,'origin-list')]:
        broken=baseline.copy();broken[4]=(200,origin)
        probe('old-header-'+label,broken,'health:oldOrigin')
    probe('exact-restoration')

    # Keep verify_services real. Replace only its unrelated container/file inputs.
    plan={'target':'openplan_project_combined_preview_'+'a'*24,'names':{kind:'owned-'+kind for kind in p.IMAGES}}
    receipts={kind:dict(name=plan['names'][kind],database=plan['target']) for kind in p.IMAGES}
    read=l.read
    def integration_read(name):
        if name=='service-receipts-private.json':return receipts
        if name=='envs-private.json':return {kind:{} for kind in p.IMAGES}
        if name=='app-env-private.json':return {'SUPABASE_SERVICE_ROLE_KEY':'synthetic-service'}
        raise HealthControlFailure('health-control:integration:unexpected-read')
    # probe patches read for health. Its integration entry restores this reader.
    def verify():
        with patch.object(l,'read',side_effect=integration_read):return l.verify_services()
    with patch.object(l,'pinned_files',return_value=plan),patch.object(l,'db_check'),patch.object(l,'target_check'),patch.object(l,'expected_service',return_value={}),patch.object(l,'observed_service',return_value={}):
        probe('verify-services-baseline',entry=verify)
        broken=baseline.copy();broken[4]=(200,old)
        probe('verify-services-reflected-old',broken,'health:oldOrigin',entry=verify)
        probe('verify-services-restoration',entry=verify)
    assert l.read is read
    return rows


if __name__=='__main__':print(json.dumps(run(),indent=2))
