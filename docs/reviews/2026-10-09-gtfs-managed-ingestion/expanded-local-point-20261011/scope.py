"""Pure ownership refusals for the prepared expanded local transit point."""
import re
from urllib.parse import urlsplit

DB_ID='a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
DB_NAME='supabase_db_openplan-restore-target-2026091050'
DATABASE='openplan_recovered_2553c3e83129432e86c97cf3aef72aee'
NETWORK='supabase_network_openplan-restore-target-2026091050'
API='http://127.74.9.10:29941'
HEAD='bf1f6ffa710b11b7f36747a676943edab667a4ae'
ORIGINALS={
 'rest':'e743ca20ff99bb6db5dd7152850a0f81dd1454e90a095ba5b88b767cc51bd9c2',
 'auth':'c5763e08d0a1b7af19bf647d7fee6aadc1055bca545fbbb99f1b0701d5036879',
 'storage':'e0051cd975d3e69878a4f5d660868a821bffa45d7d250311307d0de58b6b12a7',
 'gateway':'258ac4e4729cce3a4c10db2f49fa1ac61f964398e5f85676145c9fee65f51488',
}
ORIGINAL_NAMES={'rest': '/openplan-gtfs-restored-rest-932fcb15385e', 'auth': '/openplan-gtfs-restored-auth-a455caea7cfe', 'storage': '/openplan-gtfs-restored-storage-65cdacdeed55', 'gateway': '/openplan-gtfs-restored-gateway-9d4c12ffc641'}
IMAGES={
 'rest':'sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326',
 'auth':'sha256:2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd',
 'storage':'sha256:a4846b3329f3afd52cd2ae31b89a0c1ae841221e9d3a22d55db65f9dca2a72b6',
 'gateway':'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d',
}
STORAGE='/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/browser-full-restore-02/recovered-private/storage-objects'
GATEWAY='/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/browser-full-restore-02/kong-runtime-private.json'

def require(value,reason):
    if not value:raise ValueError(reason)

def verify_database(info):
    require(info['Id']==DB_ID and info['Name']=='/'+DB_NAME,'expanded-database-identity')
    require(info['State']['Running'] and info['Config']['Labels'].get('com.supabase.cli.project')=='openplan-restore-target-2026091050','expanded-database-owner')

def verify_original(kind,info,running=True):
    require(kind in ORIGINALS and info['Id']==ORIGINALS[kind] and info['Name']==ORIGINAL_NAMES[kind] and info['Image']==IMAGES[kind],'expanded-original-identity')
    require(info['Config']['Labels'].get('openplan.purpose')=='gtfs-browser-full-restore-02' and info['State']['Running']==running,'expanded-original-owner-state')
    require(list(info['NetworkSettings']['Networks'])==[NETWORK],'expanded-original-network')
    cap=536870912 if kind=='storage' else 268435456
    require(info['HostConfig']['Memory']==cap and info['HostConfig']['MemorySwap']==cap and info['HostConfig']['NanoCpus']==500000000,'expanded-original-limits')
    if kind!='gateway':
        env=dict(row.split('=',1) for row in info['Config']['Env'] if '=' in row)
        key={'rest':'PGRST_DB_URI','auth':'GOTRUE_DB_DATABASE_URL','storage':'DATABASE_URL'}[kind]
        uri=urlsplit(env[key]);require(uri.hostname==DB_NAME and uri.path=='/'+DATABASE,'expanded-original-uri')
    expected=[] if kind in ('rest','auth') else [(STORAGE,'/mnt',True)] if kind=='storage' else [(GATEWAY,'/etc/kong/proof.json',False)]
    require([(m['Source'],m['Destination'],m['RW']) for m in info['Mounts'] if m['Type']=='bind']==expected and len(info['Mounts'])==len(expected),'expanded-original-mounts')
    if kind=='gateway':
        bindings=info['HostConfig']['PortBindings'].get('8000/tcp')
        require(bindings==[{'HostIp':'127.74.9.10','HostPort':'29941'}],'expanded-original-gateway')

def verify_plan(plan,head,dirty,existing,app_active,worker_active,foreign_tables,scheduled_jobs,outbound_jobs):
    require(plan['sourceHead']==HEAD and head==HEAD and not dirty,'expanded-source')
    require(plan['databaseContainerId']==DB_ID and plan['originalDatabase']==DATABASE and plan['logicalApi']==API and plan['originalServiceIdentities']==ORIGINALS,'expanded-plan-identity')
    names=[plan['sourceDatabase'],plan['targetDatabase']]
    require(len(set(names))==2 and all(re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',name) for name in names),'expanded-fresh-names')
    require(not any(name in existing for name in names),'expanded-existing-database')
    require(not app_active and not worker_active,'expanded-active-owner')
    require(foreign_tables==0 and scheduled_jobs==0 and outbound_jobs==0,'expanded-unquiesced-jobs')

def verify_properties(properties,delegated):
    require(properties['encoding']=='UTF8' and properties['localeProvider'] in ('c','i'),'expanded-locale')
    require(delegated==0,'expanded-delegated-grantors')
    require(type(properties['connectionLimit']) is int and properties['connectionLimit']>=-1,'expanded-connection-limit')

def verify_pending(job,terminal,version):
    require(job['versionId']==version and job['settled'] is False,'expanded-pending-job')
    require(terminal['payload']['operation']=='complete' and terminal['resolved'] is False and terminal['receipt'] is None,'expanded-pending-completion')
