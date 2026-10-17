BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL application_name='budget-target-history';
SET LOCAL standard_conforming_strings=on;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
SET LOCAL idle_in_transaction_session_timeout='10s';
SET LOCAL work_mem='16MB';
SELECT jsonb_build_object('catalogIdentity',(SELECT jsonb_build_object('database',current_database(),
 'oid',(SELECT oid::int8 FROM pg_database WHERE datname=current_database()),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'pid',pg_backend_pid(),'sessionRole',session_user,'currentRole',current_user,
 'sessionOid',(SELECT oid::int8 FROM pg_roles WHERE rolname=session_user),
 'currentOid',(SELECT oid::int8 FROM pg_roles WHERE rolname=current_user),
 'postgresOid',(SELECT oid::int8 FROM pg_roles WHERE rolname='postgres'),
 'adminSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname=session_user),
 'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),
 'applicationName',current_setting('application_name'),'version',current_setting('server_version_num'))),'originalScope',(SELECT jsonb_build_object('scopeSchema','budget-protected-catalog-v2',
 'databases',(SELECT jsonb_agg(jsonb_build_object(
 'name',datname,'oid',oid::int8,'owner',datdba::int8,'acl',datacl,
 'settings',(SELECT pg_catalog.jsonb_build_object(
 'rows',pg_catalog.count(*)::int8,
 'digest',pg_catalog.md5(coalesce(pg_catalog.string_agg(
 pg_catalog.md5(pg_catalog.jsonb_build_object('row',pg_catalog.to_jsonb(s),
 'setconfigType',pg_catalog.pg_typeof(s.setconfig)::text,
 'setconfigDimensions',pg_catalog.array_dims(s.setconfig))::text),
 '' ORDER BY s.setrole),'')))
 FROM pg_catalog.pg_db_role_setting s WHERE s.setdatabase=d.oid)) ORDER BY datname)
 FROM pg_database d WHERE datname<>'openplan_budget_native_9c47bd610f2a49e8a35c706d'),
 'roles',(SELECT md5(string_agg(md5(to_jsonb(r)::text),'' ORDER BY oid)) FROM pg_authid r),
 'memberships',(SELECT md5(coalesce(string_agg(md5(to_jsonb(m)::text),'' ORDER BY roleid,member,grantor),'')) FROM pg_auth_members m),
 'globalSettings',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY setrole),'')) FROM pg_db_role_setting s WHERE setdatabase=0))),'readOnly',current_setting('transaction_read_only'));
ROLLBACK;
