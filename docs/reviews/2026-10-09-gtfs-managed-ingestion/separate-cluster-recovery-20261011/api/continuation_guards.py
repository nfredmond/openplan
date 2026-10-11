"""Bind recovered API observations to the exact new cluster and gateway."""
import ipaddress
from scope import require, DATABASE, DB_ID

def binding(state, receipt, address, subnet):
    require(state['database'] == DATABASE and receipt['id'] == DB_ID, 'api-continuation-database')
    host=ipaddress.ip_address(address); network=ipaddress.ip_network(subnet)
    require(host.version == 4 and host.is_private and not host.is_loopback and host in network,
            'api-continuation-address')
    return 'http://'+str(host)+':8000'

def replies(expected, actual):
    require(bool(actual) and {(r['requestSha256'],r['responseSha256']) for r in expected}
            == {(r['requestSha256'],r['responseSha256']) for r in actual}, 'api-continuation-exact-reply')

def file_changes(before, after, permitted):
    require(set(before) == set(after), 'api-continuation-file-census')
    changed={name for name in before if before[name] != after[name]}
    require(changed == set(permitted), 'api-continuation-file-changes')
    return sorted(changed)
