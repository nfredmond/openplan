"""Preparation-only fixed SQL renderer. No SQL or other transport is present.

No CLI, environment, secret lookup, source copying, database connection or dispatch.
A later pure controller may call render() with bounded supplied JSON objects.
The returned SQL still requires independent review and a separately owned runner.
"""
import json
from pathlib import Path
import re
import uuid

ACTORS = ('a_owner', 'a_owner2', 'a_admin', 'a_member', 'a_viewer',
          'b_only', 'dual', 'outsider', 'revocable')
MEMBERS = (('A', 'a_owner', 'owner'), ('A', 'a_owner2', 'owner'),
           ('A', 'a_admin', 'admin'), ('A', 'a_member', 'member'),
           ('A', 'a_viewer', 'viewer'), ('A', 'dual', 'admin'),
           ('A', 'revocable', 'member'), ('B', 'b_only', 'owner'),
           ('B', 'dual', 'admin'))
SOURCE = 'd0d12c406df8b8fd29bd2611a9cb29d8c3168ab8'
APP = '44e638d6d79378042343bf5b18408f09ee991d57'
TARGET = 'openplan_budget_native_9c47bd610f2a49e8a35c706d'


def require(value, label):
    if not value:
        raise ValueError(label)


def canonical_uuid(value):
    require(isinstance(value, str), 'uuid-text')
    parsed = uuid.UUID(value)
    require(str(parsed) == value and parsed.version == 4, 'uuid-canonical-v4')
    return value


def literal(value):
    # Values come only from typed manifests or fixed constants, never SQL fragments.
    return "'" + value.replace("'", "''") + "'"


def validate_manifest(m):
    require(set(m) == {'status', 'database', 'workspaceA', 'workspaceB', 'actors',
                      'memberships', 'seedWriter', 'generatorAliases', 'aliasMeaning',
                      'automaticWorkspaceIds', 'credentials', 'nativeAdmission'}, 'manifest-fields')
    require(m['status'] == 'UNALLOCATED_NOT_AVAILABLE_UNADMITTED', 'proposal-status')
    require(m['database'] == TARGET, 'proposal-target')
    require(set(m['actors']) == set(ACTORS), 'actor-set')
    ids = [canonical_uuid(m[k]) for k in ('workspaceA', 'workspaceB')]
    ids += [canonical_uuid(m['actors'][k]) for k in ACTORS]
    require(len(set(ids)) == 11, 'unique-identities')
    require(sorted(map(tuple, m['memberships'])) == sorted(MEMBERS), 'membership-exact-set')
    require(m['seedWriter'] == 'dual' and m['generatorAliases'] ==
            {'owner': 'dual', 'assignee': 'a_member'}, 'actor-aliases')
    require(all(m[k] is None for k in ('automaticWorkspaceIds', 'credentials', 'nativeAdmission')),
            'no-native-claim')


def validate_allocation(a):
    # This validates shape only. A separate root recorder authenticates these facts.
    fields = {'database', 'databaseOid', 'systemIdentifier', 'adminSessionOid',
              'adminEffectiveOid', 'authenticatedOid', 'ordinarySessionOid',
              'lease', 'exclusive', 'rootRecordSha256', 'orderedHistorySha256',
              'catalogSha256', 'source', 'app', 'status'}
    require(set(a) == fields, 'allocation-fields')
    require(a['database'] == TARGET and a['exclusive'] is True and
            a['status'] == 'SUPPLIED_FOR_TEXT_ONLY', 'allocation-target-exclusive')
    for key in ('databaseOid', 'adminSessionOid', 'adminEffectiveOid',
                'authenticatedOid', 'ordinarySessionOid'):
        require(type(a[key]) is int and 0 < a[key] <= 4294967295, 'positive-typed-oid-' + key)
    require(isinstance(a['systemIdentifier'], str) and
            re.fullmatch(r'[1-9][0-9]{0,19}', a['systemIdentifier']) is not None and
            int(a['systemIdentifier']) <= 18446744073709551615, 'positive-system-identifier')
    canonical_uuid(a['lease'])
    for key in ('rootRecordSha256', 'orderedHistorySha256', 'catalogSha256'):
        require(isinstance(a[key], str) and re.fullmatch('[0-9a-f]{64}', a[key]) is not None,
                'allocation-digest-' + key)
    require(a['source'] == SOURCE and a['app'] == APP, 'source-binding')
    require(a['authenticatedOid'] not in (a['adminSessionOid'], a['adminEffectiveOid']),
            'ordinary-admin-separation')


def render(m, a):
    """Return four reviewed text artifacts; supplied allocation is never admission."""
    validate_manifest(m)
    validate_allocation(a)
    templates = {}
    for name in ('identity', 'provision', 'ordinary'):
        data = (Path(__file__).parent / (name + '.sql.in')).read_bytes()
        require(len(data) <= 16384, 'template-size')
        templates[name] = data.decode('utf-8')
    users = []
    for actor in ACTORS:
        ident = m['actors'][actor]
        org = 'SYNTHETIC budget caller ' + actor
        email = actor + '-' + ident + '@budget-native.invalid'
        meta = json.dumps({'org_name': org}, sort_keys=True, separators=(',', ':'))
        users.append('(' + ','.join(map(literal, (ident, email, meta))) + ')')
    memberships = ['(' + ','.join(map(literal, (m['workspace' + w], m['actors'][who], role))) + ')'
                   for w, who, role in MEMBERS]
    values = {'DATABASE': literal(TARGET), 'DATABASE_OID': str(a['databaseOid']),
              'SYSTEM_ID': literal(a['systemIdentifier']),
              'ADMIN_SESSION_OID': str(a['adminSessionOid']),
              'ADMIN_EFFECTIVE_OID': str(a['adminEffectiveOid']),
              'AUTHENTICATED_OID': str(a['authenticatedOid']),
              'ORDINARY_SESSION_OID': str(a['ordinarySessionOid']),
              'LEASE': literal(a['lease']), 'ROOT_SHA': literal(a['rootRecordSha256']),
              'HISTORY_SHA': literal(a['orderedHistorySha256']),
              'CATALOG_SHA': literal(a['catalogSha256']),
              'USERS': ',\n'.join(users), 'MEMBERS': ',\n'.join(memberships),
              'USER_IDS': ','.join(literal(m['actors'][k]) + '::uuid' for k in ACTORS),
              'A': literal(m['workspaceA']), 'B': literal(m['workspaceB'])}
    out = {}
    for name, template in templates.items():
        tokens = set(re.findall(r'@@([A-Z_]+)@@', template))
        require(tokens <= set(values), 'unknown-template-token')
        out[name + '.sql'] = re.sub(r'@@([A-Z_]+)@@', lambda match: values[match[1]], template)
    out['r2-prerequisites.json'] = json.dumps({
        'status': 'TEXT_ONLY_NOT_NATIVE_READY', 'database': TARGET,
        'workspaceA': m['workspaceA'], 'workspaceB': m['workspaceB'],
        'owner': m['actors']['dual'], 'assignee': m['actors']['a_member'],
        'actualCreatorRoleA': 'admin', 'actualCreatorRoleB': 'admin',
        'requiresIndependentCommittedOrdinaryReadback': True}, indent=2) + '\n'
    return out
