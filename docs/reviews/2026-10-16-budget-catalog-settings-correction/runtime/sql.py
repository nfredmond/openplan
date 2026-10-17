"""Fixed SQL builders. The lexer only admits these pinned sources and pg_restore output."""
import re

import policy as p

BOUNDS = "SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='20s'; SET LOCAL work_mem='16MB';"
HISTORY_ROWS = "SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations"
HISTORY_DIGEST = "SELECT md5(coalesce(string_agg(md5(to_jsonb(h)::text),'' ORDER BY md5(to_jsonb(h)::text)),'')) FROM supabase_migrations.schema_migrations h"
HISTORY_STATEMENTS = """SELECT coalesce(jsonb_agg(jsonb_build_object('version',h.version,
 'cardinality',cardinality(h.statements),'dimensions',array_dims(h.statements),
 'sha256',(SELECT coalesce(jsonb_agg(CASE WHEN u.statement IS NULL THEN NULL ELSE
 encode(pg_catalog.sha256(pg_catalog.convert_to(u.statement,'UTF8')),'hex') END
 ORDER BY u.ordinality),'[]'::jsonb) FROM unnest(h.statements) WITH ORDINALITY u(statement,ordinality)))
 ORDER BY h.version),'[]'::jsonb) FROM supabase_migrations.schema_migrations h"""
IDENTITY = """SELECT jsonb_build_object('database',current_database(),
 'oid',(SELECT oid::int8 FROM pg_database WHERE datname=current_database()),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'pid',pg_backend_pid(),'sessionRole',session_user,'currentRole',current_user,
 'sessionOid',(SELECT oid::int8 FROM pg_roles WHERE rolname=session_user),
 'currentOid',(SELECT oid::int8 FROM pg_roles WHERE rolname=current_user),
 'postgresOid',(SELECT oid::int8 FROM pg_roles WHERE rolname='postgres'),
 'adminSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname=session_user),
 'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),
 'applicationName',current_setting('application_name'),'version',current_setting('server_version_num'))"""
SCOPE_SCHEMA = 'budget-protected-catalog-v2'
CATALOG_BEGIN = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL application_name='budget-target-history';
SET LOCAL standard_conforming_strings=on;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL idle_in_transaction_session_timeout='10s';
SET LOCAL work_mem='16MB';
"""
SETTINGS_SUMMARY = """SELECT pg_catalog.jsonb_build_object(
 'rows',pg_catalog.count(*)::int8,
 'digest',pg_catalog.md5(coalesce(pg_catalog.string_agg(
 pg_catalog.md5(pg_catalog.jsonb_build_object('row',pg_catalog.to_jsonb(s),
 'setconfigType',pg_catalog.pg_typeof(s.setconfig)::text,
 'setconfigDimensions',pg_catalog.array_dims(s.setconfig))::text),
 '' ORDER BY s.setrole),'')))
 FROM pg_catalog.pg_db_role_setting s WHERE s.setdatabase=d.oid"""
SCOPE = """SELECT jsonb_build_object('scopeSchema','budget-protected-catalog-v2',
 'databases',(SELECT jsonb_agg(jsonb_build_object(
 'name',datname,'oid',oid::int8,'owner',datdba::int8,'acl',datacl,
 'settings',("""+SETTINGS_SUMMARY+""")) ORDER BY datname)
 FROM pg_database d WHERE datname<>'openplan_budget_native_9c47bd610f2a49e8a35c706d'),
 'roles',(SELECT md5(string_agg(md5(to_jsonb(r)::text),'' ORDER BY oid)) FROM pg_authid r),
 'memberships',(SELECT md5(coalesce(string_agg(md5(to_jsonb(m)::text),'' ORDER BY roleid,member,grantor),'')) FROM pg_auth_members m),
 'globalSettings',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY setrole),'')) FROM pg_db_role_setting s WHERE setdatabase=0))"""
PROPERTIES = """SELECT jsonb_build_object('database',d.datname,'oid',d.oid::int8,
 'owner',pg_get_userbyid(d.datdba),'ownerOid',d.datdba::int8,'acl',d.datacl,
 'encoding',pg_encoding_to_char(d.encoding),'collate',d.datcollate,'ctype',d.datctype,
 'localeProvider',d.datlocprovider,'icuLocale',d.datlocale,'collationVersion',d.datcollversion,
 'settings',("""+SETTINGS_SUMMARY+"""))
 FROM pg_database d WHERE d.datname=current_database()"""
CATALOG_NAMES = "SELECT coalesce(jsonb_agg(datname ORDER BY datname),'[]') FROM pg_database"

EMPTY = """SELECT jsonb_build_object('schemas',(SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')),
 'relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
 'functions',(SELECT count(*) FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'))"""
EMPTY_GUARD = """DO $empty$ BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')) OR
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') OR
 EXISTS(SELECT 1 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema')
 THEN RAISE EXCEPTION 'restore-empty-guard'; END IF; END $empty$;"""
SNAPSHOT = """CREATE TEMP TABLE budget_snapshot(label text PRIMARY KEY,value jsonb) ON COMMIT DROP;
DO $snapshot$ DECLARE t record; value jsonb; BEGIN
 FOR t IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','S') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname LOOP
  IF t.relkind='S' THEN EXECUTE format('SELECT pg_catalog.jsonb_build_object(''last_value'',s.last_value,''log_cnt'',s.log_cnt,''is_called'',s.is_called) FROM %I.%I s',t.nspname,t.relname) INTO value;
  ELSE EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),''''))) FROM ONLY %I.%I t',t.nspname,t.relname) INTO value; END IF;
  INSERT INTO pg_temp.budget_snapshot VALUES(t.nspname||'.'||t.relname,value);
 END LOOP; END $snapshot$;
INSERT INTO pg_temp.budget_snapshot SELECT '__pg_sequences__',to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM pg_sequences t;
SELECT jsonb_build_object('snapshot',(SELECT jsonb_object_agg(label,value ORDER BY label) FROM pg_temp.budget_snapshot));"""
DEFINITIONS = """SELECT coalesce(jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object(
 'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'ownerOid',p.proowner::int8,
 'language',l.lanname,'result',pg_get_function_result(p.oid),'definer',p.prosecdef,'volatility',p.provolatile,
 'config',p.proconfig,'rawACL',p.proacl,'effectiveACL',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'grantor',grantor::int8,'grantee',grantee::int8,'privilege',privilege_type,'grantable',is_grantable)
 ORDER BY grantor,grantee,privilege_type),'[]') FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))))), '{}'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.prokind IN ('f','p')"""
WANTED = {
 'projects': ['id','workspace_id','budget_amount'],
 'project_deliverables': ['id','project_id','title','summary','owner_label','due_date','status','created_at','updated_at','budget_amount','percent_complete','assignee_user_id'],
 'project_spend_entries': ['id','project_id','deliverable_id','entry_date','amount','description','vendor_label','created_at'],
 'client_invoices': ['id','workspace_id','project_id','status'],
 'client_invoice_line_items': ['id','invoice_id','deliverable_id','amount'],
 'workspace_members': ['workspace_id','user_id','role']}


def literal(value):
    p.require(type(value) is str and '\0' not in value, 'sql-literal')
    return "'"+value.replace("'", "''")+"'"


def wanted_sql():
    values = ','.join('('+literal(table)+','+literal(col)+')'
                      for table, columns in WANTED.items() for col in columns)
    return """WITH wanted(relation,col) AS (VALUES """+values+"""),
 roles(name) AS (VALUES ('anon'),('authenticated'),('service_role'),('postgres'))
 SELECT jsonb_agg(jsonb_build_object('role',roles.name,'roleMissing',r.oid IS NULL,
 'relation',w.relation,'column',w.col,'relationMissing',c.oid IS NULL,'attributeMissing',a.attnum IS NULL,
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRLS',c.relforcerowsecurity,
 'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'rawTableACL',c.relacl,'rawColumnACL',a.attacl,
 'effectiveTableACL',CASE WHEN c.oid IS NULL THEN NULL ELSE (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY grantor,grantee,privilege_type),'[]') FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x) END,
 'effectiveColumnACL',CASE WHEN a.attnum IS NULL THEN NULL ELSE (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY grantor,grantee,privilege_type),'[]') FROM aclexplode(coalesce(a.attacl,'{}'::aclitem[])) x) END,
 'tableSelect',CASE WHEN r.oid IS NULL OR c.oid IS NULL THEN NULL ELSE has_table_privilege(r.oid,c.oid,'SELECT') END,
 'columnSelect',CASE WHEN r.oid IS NULL OR a.attnum IS NULL THEN NULL ELSE has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') END)
 ORDER BY roles.name,w.relation,w.col) FROM wanted w CROSS JOIN roles
 LEFT JOIN pg_roles r ON r.rolname=roles.name
 LEFT JOIN pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=w.relation
 LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=w.col AND a.attnum>0 AND NOT a.attisdropped"""


def guard(identity, database=p.TARGET):
    p.positive(identity['oid'], 'guard-oid')
    for key in ('sessionOid', 'currentOid', 'postgresOid'):
        p.positive(identity[key], 'guard-'+key)
    checks = ["current_database()<>"+literal(database),
        "(SELECT oid::int8 FROM pg_database WHERE datname=current_database())<>"+str(identity['oid']),
        "(SELECT system_identifier::text FROM pg_control_system())<>"+literal(identity['systemIdentifier']),
        "session_user<>'supabase_admin'", "current_user<>'supabase_admin'",
        "(SELECT oid::int8 FROM pg_roles WHERE rolname=session_user)<>"+str(identity['sessionOid']),
        "(SELECT oid::int8 FROM pg_roles WHERE rolname=current_user)<>"+str(identity['currentOid']),
        "(SELECT oid::int8 FROM pg_roles WHERE rolname='postgres')<>"+str(identity['postgresOid']),
        "NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user)",
        "(SELECT rolsuper FROM pg_roles WHERE rolname='postgres')",
        "current_setting('standard_conforming_strings')<>'on'",
        "current_setting('server_version_num')<>'170006'"]
    return "DO $identity$ BEGIN IF "+' OR '.join(checks)+" THEN RAISE EXCEPTION 'native-same-backend-identity'; END IF; END $identity$;\n"


def statements(text, *, restore=False):
    """Return top-level spans. Reject unknown meta commands and unfinished COPY."""
    spans = []
    i = start = 0
    quote = None
    block = 0
    line_comment = False
    dollar = None
    copy_data = False
    while i < len(text):
        if copy_data:
            end = text.find('\n', i)
            p.require(end != -1, 'sql-copy-unterminated')
            if text[i:end].rstrip('\r') == r'\.':
                copy_data = False
                start = end+1
            i = end+1
            continue
        c = text[i]
        if line_comment:
            line_comment = c != '\n'
        elif block:
            if text.startswith('/*', i):
                block += 1; i += 1
            elif text.startswith('*/', i):
                block -= 1; i += 1
        elif dollar:
            if text.startswith(dollar, i):
                i += len(dollar)-1; dollar = None
        elif quote:
            if c == quote:
                if text[i:i+2] == quote*2:
                    i += 1
                else:
                    quote = None
        elif text.startswith('--', i):
            line_comment = True; i += 1
        elif text.startswith('/*', i):
            block = 1; i += 1
        elif c in "'\"":
            p.require(not (c=="'" and i>0 and text[i-1] in 'eE' and
                          (i==1 or not (text[i-2].isalnum() or text[i-2]=='_'))),
                      'sql-escape-string-unreviewed')
            quote = c
        elif c == '$' and (match := re.match(r'\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$', text[i:])):
            dollar = match.group(); i += len(dollar)-1
        elif c == '\\':
            end = text.find('\n', i)
            p.require(restore and (i == 0 or text[i-1] == '\n') and end != -1 and
                re.fullmatch(r'\\(?:unrestrict|restrict) [A-Za-z0-9]+\r?', text[i:end]),
                'sql-meta-command-unreviewed')
            prefix = re.sub(r'/\*.*?\*/|--[^\n]*', '', text[start:i], flags=re.S).strip()
            p.require(not prefix, 'sql-meta-position')
            i = end
            start = i+1
        elif c == ';':
            raw = text[start:i+1]
            # Comments are ignored for top-level transaction-token classification.
            token = re.sub(r'/\*.*?\*/|--[^\n]*', ' ', raw, flags=re.S).strip()
            p.require(bool(token), 'sql-empty-statement')
            spans.append((start, i+1, token))
            start = i+1
            if restore and re.match(r'^COPY\b', token, re.I):
                p.require(re.search(r'\bFROM stdin;\s*$', token, re.I), 'sql-copy-form')
                p.require(text[start:start+1] == '\n', 'sql-copy-newline')
                i += 1
                copy_data = True
        i += 1
    p.require(not (quote or dollar or block or copy_data), 'sql-unterminated')
    tail = re.sub(r'/\*.*?\*/|--[^\n]*', '', text[start:], flags=re.S).strip()
    p.require(not tail, 'sql-tail-unreviewed')
    return spans


def body(raw, *, outer=False, restore=False):
    text = raw.decode('utf8')
    spans = statements(text, restore=restore)
    p.require(bool(spans), 'sql-no-statements')
    # Only exact BEGIN / COMMIT wrappers are extracted. Function BEGINs are
    # inside dollar quotes. SAVEPOINT/END/START/PREPARE cannot pass as body SQL.
    transactions = [(a,b,t) for a,b,t in spans if re.match(
        r'^(BEGIN|COMMIT|END|ROLLBACK|START|SAVEPOINT|RELEASE|PREPARE|ABORT)\b', t, re.I)]
    if outer:
        p.require(len(transactions) == 2 and transactions[0] == spans[0] and
                  transactions[1] == spans[-1] and
                  transactions[0][2].upper() == 'BEGIN;' and
                  transactions[1][2].upper() == 'COMMIT;', 'sql-outer-atomicity')
        a,b,_ = transactions[0]
        c,d,_ = transactions[1]
        # Keep comments and pg_restore restriction commands in place.
        return (text[:a]+text[a:b].replace('BEGIN;', '', 1)+text[b:c]+
                text[c:d].replace('COMMIT;', '', 1)+text[d:]).encode()
    p.same([], transactions, 'sql-body-transaction-control')
    return raw


def migration(raw, number, name, identity, history_digest):
    p.require(number in (17,18,19), 'migration-number')
    p.require(re.fullmatch('[a-f0-9]{32}', history_digest), 'migration-history-digest')
    raw.decode('utf8')
    payload = body(raw, outer=number == 19)
    text = "BEGIN;\n"+BOUNDS+'\n'+guard(identity)
    text += "SET LOCAL ROLE postgres;\nDO $role$ BEGIN IF current_user<>'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'migration-role'; END IF; END $role$;\n"
    text += 'LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;\n'
    text += "DO $history$ BEGIN IF ("+HISTORY_DIGEST+") IS DISTINCT FROM "+literal(history_digest)+" THEN RAISE EXCEPTION 'migration-history-race'; END IF; END $history$;\n"
    text += payload.decode('utf8')+'\n'
    text += 'INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('
    # ASCII hex contains no backslashes or apostrophes. History text therefore
    # does not depend on either standard_conforming_strings setting. The body
    # still has the explicit SET and same-backend guard before its own parsing.
    encoded = "pg_catalog.convert_from(pg_catalog.decode('"+raw.hex()+"','hex'),'UTF8')"
    text += literal('202610170000'+str(number))+','+literal(name)+',ARRAY['+encoded+']::text[]);\n'
    text += "SELECT jsonb_build_object('transactionID',pg_current_xact_id()::text,'pid',pg_backend_pid(),'role',current_user);\nCOMMIT;\n"
    text += "SELECT jsonb_build_object('commitACK',true,'pid',pg_backend_pid(),'inTransaction',false);\n"
    return ("SET application_name='budget-target-history'; SET standard_conforming_strings=on;\n"+text).encode()


def restore(raw, identity):
    # Rendering is a separate admitted read-only stage. Root reviews its exact
    # generated guarded SQL before publishing restore419's input hash.
    extracted = body(raw, outer=True, restore=True)
    # pg_restore emits zero timeout defaults. Keep the fixed finite bounds
    # throughout the actual restore, rather than letting that prologue undo them.
    text = extracted.decode()
    replacements = []
    for a,b,token in statements(text, restore=True):
        match = re.fullmatch(r'SET (statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout) = 0;', token)
        if match:
            value = {'statement_timeout':'60s','lock_timeout':'3s',
                     'idle_in_transaction_session_timeout':'20s','transaction_timeout':'180s'}[match[1]]
            replacements.append((a,b,"SET LOCAL "+match[1]+"='"+value+"';"))
        elif re.match(r'^SET\s+(?:LOCAL\s+|SESSION\s+)?(?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout)\b',token,re.I):
            raise ValueError('restore-timeout-form-unreviewed')
    for a,b,value in reversed(replacements):
        text = text[:a]+value+text[b:]
    extracted = text.encode()
    # Restriction commands may surround the script. They are not allowed inside
    # our SQL transaction; leaving them there is safe in psql restricted mode.
    return ("SET application_name='budget-target-history'; SET standard_conforming_strings=on;\nBEGIN;\n"+
        BOUNDS+'\n'+guard(identity)+EMPTY_GUARD+'\n\\o /dev/null\n').encode()+extracted+b"\n\\o\nCOMMIT;\nSELECT jsonb_build_object('commitACK',true,'pid',pg_backend_pid(),'inTransaction',false);\n"
