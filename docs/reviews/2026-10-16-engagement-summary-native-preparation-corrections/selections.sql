-- PREPARED ONLY. Never executed in this preparation.
-- Named parameters use a future recorder's bound parameters, not string replacement.
-- Root must supply exact target/cluster/session admission before every connection.
-- Each query is a separate observation. This file does not make them atomic.

-- Actual SQL20 identity, installed definition, security and effective ACL.
SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result, p.provolatile, p.prosecdef,
       p.proowner, pg_get_userbyid(p.proowner) AS owner, l.lanname,
       p.proconfig, p.proacl AS raw_acl,
       pg_get_functiondef(p.oid) AS definition,
       (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.privilege_type)
        FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS expanded_acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.proname='engagement_billed_summaries_v1'
ORDER BY arguments;

-- Exact wanted census emits missing rows rather than hiding them in an inner join.
WITH wanted(relation,column_name) AS (VALUES
 ('workspace_members','workspace_id'),('workspace_members','user_id'),('workspace_members','role'),
 ('invoicing_engagements','id'),('invoicing_engagements','workspace_id'),('invoicing_engagements','not_to_exceed_amount'),
 ('client_invoices','id'),('client_invoices','workspace_id'),('client_invoices','engagement_id'),
 ('client_invoices','status'),('client_invoices','subtotal_amount'))
SELECT w.*, c.oid AS relation_oid, a.attnum, format_type(a.atttypid,a.atttypmod) AS type,
       a.attnotnull, c.relrowsecurity, c.relforcerowsecurity, c.relowner,
       CASE WHEN c.oid IS NOT NULL THEN has_table_privilege(current_user,c.oid,'SELECT') END AS table_select,
       CASE WHEN a.attnum IS NOT NULL THEN has_column_privilege(current_user,c.oid,a.attnum,'SELECT') END AS column_select
FROM wanted w LEFT JOIN pg_namespace n ON n.nspname='public'
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=w.relation
LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=w.column_name AND a.attnum>0 AND NOT a.attisdropped
ORDER BY w.relation,w.column_name;

-- Actual recorder repeats for each intended role, preserving denied as false.
-- PUBLIC grantee zero and inherited privileges need the expanded ACL above too.
SELECT r.oid,r.rolname,r.rolsuper,r.rolbypassrls,
       has_function_privilege(r.oid,to_regprocedure('public.engagement_billed_summaries_v1(uuid,uuid,uuid)'),'EXECUTE') AS can_execute
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres') ORDER BY r.rolname;

SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN
 ('workspace_members','invoicing_engagements','client_invoices','client_invoice_line_items','invoicing_clients','projects')
ORDER BY tablename,policyname;
SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,
       pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('client_invoices','client_invoice_line_items','invoicing_engagements','projects')
AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('client_invoices','client_invoice_line_items','invoicing_engagements')
ORDER BY c.relname,k.conname;

-- Ordinary caller: recorder binds session, effective role, role OIDs and intended JWT actor.
-- No privilege is added to make an ordinary caller query cluster-control functions.
SELECT current_database(),(SELECT oid FROM pg_database WHERE datname=current_database()) AS database_oid,
       session_user,current_user,auth.uid(),current_setting('row_security') AS row_security,
       current_setting('transaction_isolation') AS isolation,pg_backend_pid();

-- Direct production scalar call, all three arguments explicit, same caller as SDK.
SELECT public.engagement_billed_summaries_v1($1::uuid,$2::uuid,$3::uuid);

-- Independent exact row readback, dual-member ordinary caller, scoped to explicit new fixture IDs.
-- Recorder binds $1 to the finite exact full invoice-ID array, never arbitrary retained rows.
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',i.id,'workspace_id',i.workspace_id,'engagement_id',i.engagement_id,'project_id',i.project_id,
 'status',i.status,'subtotal_amount',i.subtotal_amount::text,'retention_amount',i.retention_amount::text,
 'total_amount',i.total_amount::text,'invoice_date',i.invoice_date,'created_at',i.created_at
) ORDER BY i.id),'[]'::jsonb)
FROM public.client_invoices i WHERE i.id=ANY($1::uuid[]);

-- One exact expected line per parent in this corpus. No fabricated deliverable/time/contract link.
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',l.id,'invoice_id',l.invoice_id,'amount',l.amount::text,'position',l.position,
 'deliverable_id',l.deliverable_id,'milestone_id',l.milestone_id
) ORDER BY l.id),'[]'::jsonb)
FROM public.client_invoice_line_items l WHERE l.invoice_id=ANY($1::uuid[]);

-- History belongs to target/history owner, separately before and after SQL20.
SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version;
-- Record array cardinality/dimensions and original UTF-8 digest using the reviewed
-- target/history pattern. Never fabricate history from file count or parse an archive here.
