"""Pure guards for the planned coordinated transit recovery."""
import re

CONTAINER='a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
TEMPLATE='openplan_recovered_2553c3e83129432e86c97cf3aef72aee'
HEAD='bf1f6ffa710b11b7f36747a676943edab667a4ae'
TARGET='http://127.74.9.10:29941'

def require(value,reason):
    if not value:raise ValueError(reason)

def verify_scope(plan,container,head,dirty,existing,original_active):
    require(head==HEAD and not dirty and plan['sourceHead']==HEAD,'coordinated-source')
    require(plan['containerId']==CONTAINER and container['Id']==CONTAINER and container['Name']=='/supabase_db_openplan-restore-target-2026091050','coordinated-container')
    require(container['State']['Running'] and container['Config']['Labels'].get('com.supabase.cli.project')=='openplan-restore-target-2026091050','coordinated-container-project')
    require(plan['templateDatabase']==TEMPLATE and plan['logicalTarget']==TARGET,'coordinated-template')
    names=[plan['sourceDatabase'],plan['targetDatabase']]
    require(all(re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',name) for name in names) and len(set(names))==2,'coordinated-database-identities')
    require(not any(name in existing for name in names),'coordinated-existing-database')
    require(not original_active,'coordinated-original-worker-active')

def verify_backend(info,identity,name,owner,image_id,database):
    require(info['Id']==identity and info['Name']=='/'+name,'coordinated-backend-identity')
    require(info['Config']['Labels'].get('openplan.proof.owner')==owner and info['Image']==image_id,'coordinated-backend-owner')
    env=dict(row.split('=',1) for row in info['Config']['Env'] if '=' in row)
    from urllib.parse import urlsplit
    require(urlsplit(env['PGRST_DB_URI']).path=='/'+database,'coordinated-backend-database')
    require(env.get('PGRST_OPENAPI_MODE')=='disabled','coordinated-backend-openapi')
    require(info['HostConfig']['Memory']==134217728 and info['HostConfig']['MemorySwap']==134217728 and info['HostConfig']['NanoCpus']==500000000,'coordinated-backend-limits')
    bindings=info['NetworkSettings']['Ports'].get('3000/tcp') if info['State']['Running'] else info['HostConfig']['PortBindings'].get('3000/tcp')
    require(bindings and len(bindings)==1 and bindings[0]['HostIp']=='127.0.0.1','coordinated-backend-loopback')
