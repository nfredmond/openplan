"""Compare this fixture's schema text with native policy and default-ACL catalogs."""
import hashlib, json

POLICY_KEYS = {'schema', 'table', 'name', 'command', 'permissive', 'roles', 'using', 'check'}
DEFAULT_KEYS = {'role', 'schema', 'objectType', 'privileges'}
PRIVILEGE_KEYS = {'grantor', 'grantee', 'privilege', 'grantable'}


def require(condition, reason):
    if not condition: raise ValueError(reason)


def canonical_catalog(catalog):
    require(set(catalog) == {'policies', 'defaultPrivileges'}, 'schema-catalog-sections')
    policies = []; defaults = []
    for row in catalog['policies']:
        require(set(row) == POLICY_KEYS, 'schema-policy-projection')
        require(len(row['roles']) == len(set(row['roles'])), 'schema-policy-role-duplicates')
        policies.append({**row, 'roles': sorted(row['roles'])})
    for row in catalog['defaultPrivileges']:
        require(set(row) == DEFAULT_KEYS and all(set(p) == PRIVILEGE_KEYS for p in row['privileges']), 'schema-default-projection')
        defaults.append({**row, 'privileges': sorted(row['privileges'], key=lambda p: json.dumps(p, sort_keys=True))})
    encoded = lambda row: json.dumps(row, sort_keys=True)
    return {'policies': sorted(policies, key=encoded), 'defaultPrivileges': sorted(defaults, key=encoded)}


def canonical_dump(text, policy_count):
    lines = [line for line in text.splitlines() if line.strip() and not line.startswith(('--', '\\restrict ', '\\unrestrict '))]
    policies = [line for line in lines if line.startswith('CREATE POLICY ')]
    require(len(policies) == policy_count and all(line.endswith(';') for line in policies), 'schema-policy-statement-census')
    defaults = [line for line in lines if line.startswith('ALTER DEFAULT PRIVILEGES ')]
    require(all(line.endswith(';') for line in defaults), 'schema-default-statement-shape')
    core = [line for line in lines if not line.startswith(('CREATE POLICY ', 'ALTER DEFAULT PRIVILEGES '))]
    return {'core': core, 'defaultStatements': sorted(defaults), 'policyCount': len(policies)}


def verify(expected_text, actual_text, expected_catalog, actual_catalog):
    expected = canonical_catalog(expected_catalog); actual = canonical_catalog(actual_catalog)
    require(expected['policies'] == actual['policies'], 'schema-policy-catalog')
    require(expected['defaultPrivileges'] == actual['defaultPrivileges'], 'schema-default-catalog')
    left = canonical_dump(expected_text, len(expected['policies']))
    right = canonical_dump(actual_text, len(actual['policies']))
    require(left['defaultStatements'] == right['defaultStatements'], 'schema-default-statements')
    require(left['core'] == right['core'], 'schema-core-statements')
    encode = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return {'schemaCoreSha256': encode(left['core']), 'defaultStatementsSha256': encode(left['defaultStatements']),
            'policyCatalogSha256': encode(expected['policies']), 'defaultCatalogSha256': encode(expected['defaultPrivileges']),
            'policies': len(expected['policies']), 'defaultPrivilegeGroups': len(expected['defaultPrivileges']),
            'defaultStatements': len(left['defaultStatements'])}


CATALOG_QUERY = """SELECT jsonb_build_object(
 'policies', coalesce((SELECT jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,
  'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role) END ORDER BY CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role) END) FROM unnest(p.polroles) role),
  'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
  ORDER BY n.nspname,c.relname,p.polname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace),'[]'),
 'defaultPrivileges', coalesce((SELECT jsonb_agg(jsonb_build_object(
  'role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'objectType',d.defaclobjtype,
  'privileges',coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
   'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
   'privilege',a.privilege_type,'grantable',a.is_grantable)
   ORDER BY pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
   FROM aclexplode(d.defaclacl) a),'[]'))
  ORDER BY pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype)
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),'[]'))"""
