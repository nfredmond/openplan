"""Restrict the new fixture's database attachment to its private owned network."""
import copy, ipaddress
from scope import NETWORK, DB_ID, require

PURPOSE = 'gtfs-separate-cluster-api-20261011-01'


def verify_network(info, identity, peers):
    require(info['Id'] == identity and info['Name'] == NETWORK, 'api-network-identity')
    require(info['Driver'] == 'bridge' and info['Internal']
            and info['Labels'].get('openplan.purpose') == PURPOSE, 'api-network-owner')
    require(set(info.get('Containers') or {}) == set(peers), 'api-network-peers')
    configuration = info['IPAM']['Config']
    require(len(configuration) == 1, 'api-network-ipam-count')
    subnet = ipaddress.ip_network(configuration[0]['Subnet'])
    require(subnet.version == 4 and subnet.is_private and not subnet.is_loopback
            and 16 <= subnet.prefixlen <= 28, 'api-network-cidr')
    return str(subnet)


def verify_database_attachment(info, receipt, volume, key, base_guard, attached):
    expected = {NETWORK} if attached else {'none'}
    require(set(info['NetworkSettings']['Networks']) == expected,
            'api-database-network')
    # The earlier database guard still protects command, key, volume, immutable
    # identity, limits and absence of published database ports.
    original_shape = copy.deepcopy(info)
    original_shape['NetworkSettings']['Networks'] = {'none': {}}
    base_guard(original_shape, receipt, volume, key)


def hba_rule(subnet):
    network = ipaddress.ip_network(subnet)
    require(network.version == 4 and network.is_private and not network.is_loopback
            and 16 <= network.prefixlen <= 28, 'api-hba-cidr')
    return 'host all all ' + str(network) + ' scram-sha-256\n'
