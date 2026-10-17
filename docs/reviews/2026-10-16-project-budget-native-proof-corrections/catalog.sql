-- PREPARED, NOT EXECUTED. Read only on root's NEW allocated fixture DB.
-- Recorder retains exact output bytes and hashes each returned definition.
SELECT current_database() AS database, current_user AS effective_role,
       session_user AS session_role, pg_backend_pid() AS pid,
       current_setting('server_version_num') AS server_version_num;

SELECT p.oid::regprocedure::text AS signature, pg_get_userbyid(p.proowner) AS owner,
       l.lanname AS language, p.provolatile, p.prosecdef, p.proconfig, p.proacl,
       pg_get_function_result(p.oid) AS result,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.proname IN ('project_budget_inputs_v1','guard_client_invoice_lifecycle',
 'guard_client_invoice_line_lifecycle','guard_contract_invoice','guard_closed_contract_source',
 'retain_contract_source_deletion','set_project_subrecord_updated_at',
 'bump_project_revision_from_direct_evidence','touch_project_evidence_revision',
 'workspace_member_can_write','workspace_role_rank')
ORDER BY p.oid::regprocedure::text;

SELECT p.oid::regprocedure::text AS signature,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
       pg_get_userbyid(x.grantor) AS grantor, x.privilege_type, x.is_grantable,
       p.proacl IS NULL AS uses_default
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
WHERE n.nspname='public' AND p.proname IN ('project_budget_inputs_v1','guard_client_invoice_lifecycle',
 'guard_client_invoice_line_lifecycle','guard_contract_invoice','guard_closed_contract_source',
 'retain_contract_source_deletion','set_project_subrecord_updated_at',
 'bump_project_revision_from_direct_evidence','touch_project_evidence_revision',
 'workspace_member_can_write','workspace_role_rank')
ORDER BY signature,grantee,privilege_type;

SELECT pg_get_userbyid(d.defaclrole) AS owner,
       CASE WHEN d.defaclnamespace=0 THEN '<global>' ELSE n.nspname END AS schema,
       d.defaclobjtype,d.defaclacl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
WHERE d.defaclnamespace=0 OR n.nspname='public'
ORDER BY owner,schema,d.defaclobjtype;

SELECT rolname,rolsuper,rolinherit,rolcanlogin,rolcreaterole,rolcreatedb,rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres','supabase_admin','anon','authenticated','service_role','authenticator')
ORDER BY rolname;
SELECT a.rolname AS member,b.rolname AS granted_role,m.admin_option
FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.member
JOIN pg_roles b ON b.oid=m.roleid
WHERE a.rolname IN ('postgres','supabase_admin','anon','authenticated','service_role','authenticator')
   OR b.rolname IN ('postgres','supabase_admin','anon','authenticated','service_role','authenticator')
ORDER BY member,granted_role;

SELECT c.oid::regclass::text AS relation,pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity,c.relforcerowsecurity,c.relacl,
       a.attnum,a.attname,a.attisdropped,a.attnotnull,
       format_type(a.atttypid,a.atttypmod) AS type,a.attacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
WHERE n.nspname='public' AND c.relname IN
 ('projects','project_deliverables','project_spend_entries','client_invoices',
  'client_invoice_line_items','workspace_members','invoicing_clients')
ORDER BY relation,a.attnum;

SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN
 ('projects','project_deliverables','project_spend_entries','client_invoices',
  'client_invoice_line_items','workspace_members','invoicing_clients')
ORDER BY tablename,policyname;
SELECT c.conrelid::regclass::text AS relation,c.conname,c.convalidated,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c WHERE c.conrelid IN
 (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN
  ('projects','project_deliverables','project_spend_entries','client_invoices',
   'client_invoice_line_items','workspace_members','invoicing_clients'))
ORDER BY relation,c.conname;
SELECT t.tgrelid::regclass::text AS relation,t.tgname,t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
 (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN
  ('projects','project_deliverables','project_spend_entries','client_invoices',
   'client_invoice_line_items','workspace_members','invoicing_clients'))
ORDER BY relation,t.tgname;

-- Exact SQL19 projections, including predicates/order/join fields.
WITH wanted(relation,columns) AS (VALUES
 ('projects',ARRAY['id','workspace_id','budget_amount']),
 ('project_deliverables',ARRAY['id','project_id','title','summary','owner_label',
   'due_date','status','created_at','updated_at','budget_amount','percent_complete','assignee_user_id']),
 ('project_spend_entries',ARRAY['id','project_id','deliverable_id','entry_date','amount',
   'description','vendor_label','created_at']),
 ('client_invoices',ARRAY['id','workspace_id','project_id','status']),
 ('client_invoice_line_items',ARRAY['id','invoice_id','deliverable_id','amount']),
 ('workspace_members',ARRAY['workspace_id','user_id']))
SELECT r.rolname,w.relation,col AS column,
       has_table_privilege(r.oid,c.oid,'SELECT') AS table_select,
       has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS effective_column_select
FROM wanted w JOIN pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=w.relation
CROSS JOIN LATERAL unnest(w.columns) col
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=col AND NOT a.attisdropped
CROSS JOIN pg_roles r
WHERE r.rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY r.rolname,w.relation,col;
-- Recorder compares wanted columns with pg_attribute too. A JOIN omitting an
-- absent attribute must not silently manufacture a complete projection receipt.
