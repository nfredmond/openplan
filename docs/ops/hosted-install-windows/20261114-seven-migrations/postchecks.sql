-- Post-checks for the November 14 window: all seven files, history 455.
-- The kit runs these inside the install transaction, after its own catalog
-- check (build_install.py step 6). Only DO and SELECT statements are allowed.
-- A failed check raises, so the whole window rolls back and history stays 448.
--
-- Each packet's post-checks, rebased from "this file alone" (449 or 450 rows,
-- "previous totals plus 6") to the combined end state. Totals the packets
-- stated as "plus N" are not repeated as absolute numbers here: the kit's
-- change map already requires every added, removed or changed catalog key to
-- equal the restored copy's dry run, which is stricter than a count.
--
-- Lane 29 (review 27, N5 and N8) strengthened checks that proved only that an
-- object exists: row security on the two invoice tables, the six invoice
-- policies calling their helper, the owner of the one function whose catalog
-- key is allowed to differ, the shape (row or statement, transition tables,
-- UPDATE OF columns) of the 415 and 440 triggers, and a SHA-256 of
-- pg_get_functiondef for every function the seven files create or replace.
-- The hashes were read on PostgreSQL 17.11 (supabase/postgres 17.11.0.006)
-- after installing the seven files at their plan hashes, and are the same
-- under search_path '', 'public, extensions' and 'pg_catalog, pg_temp'.

DO $check$
DECLARE n bigint; newest text;
BEGIN
  SELECT pg_catalog.count(*), pg_catalog.max(h.version) INTO n, newest FROM supabase_migrations.schema_migrations h;
  IF n <> 455 OR newest IS DISTINCT FROM '20261102140000' THEN
    RAISE EXCEPTION 'post-check history: expected 455 through 20261102140000, found % through %', n, newest;
  END IF;
  SELECT pg_catalog.count(*) INTO n FROM supabase_migrations.schema_migrations h
   WHERE h.version IN ('20261102100000', '20261102100100', '20261102110000', '20261102110100',
                       '20261102120000', '20261102130000', '20261102140000');
  IF n <> 7 THEN
    RAISE EXCEPTION 'post-check history: expected the seven window versions, found %', n;
  END IF;
END
$check$;

-- PR 408, file 20261102100000: the two crash domains admit the four state
-- layers and state_injury_file; person rows stay CCRS-only.
DO $check$
DECLARE def text; ok boolean;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid), con.convalidated INTO def, ok FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.safety_crashes'::regclass AND con.conname = 'safety_crashes_source_id_check';
  IF def IS DISTINCT FROM 'CHECK ((source_id = ANY (ARRAY[''ccrs-ca''::text, ''fars-national''::text, ''odot-or''::text, ''iowadot-ia''::text, ''odot-oh''::text, ''ddot-dc''::text])))'
     OR ok IS NOT TRUE THEN
    RAISE EXCEPTION 'post-check 408: safety_crashes_source_id_check is % (validated %)', def, ok;
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(con.oid), con.convalidated INTO def, ok FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.safety_crash_ingests'::regclass AND con.conname = 'safety_crash_ingests_coverage_state_check';
  IF def IS DISTINCT FROM 'CHECK ((coverage_state = ANY (ARRAY[''ccrs_ca_statewide''::text, ''fars_fatal_only''::text, ''state_injury_file''::text, ''switrs_legacy_local''::text, ''out_of_coverage''::text, ''source_unavailable''::text])))'
     OR ok IS NOT TRUE THEN
    RAISE EXCEPTION 'post-check 408: safety_crash_ingests_coverage_state_check is % (validated %)', def, ok;
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO def FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'safety_crash_parties_source_id_check';
  IF def IS DISTINCT FROM 'CHECK ((source_id = ''ccrs-ca''::text))' THEN
    RAISE EXCEPTION 'post-check 408: safety_crash_parties_source_id_check changed to %', def;
  END IF;
END
$check$;

-- PR 408, file 20261102100100: the per-kind GEOID helper, its privileges, its
-- answers and its owner. The bodies of all three functions are checked by
-- hash in the last block.
DO $check$
DECLARE answers text; owner_name text;
BEGIN
  IF pg_catalog.has_function_privilege('anon', 'public.bca_snapshot_tigerweb_geoid_valid(text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.valid_bca_snapshot_jurisdiction(jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.guard_project_bca_place_insert()', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-check 408: anon can execute a BCA place function';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.bca_snapshot_tigerweb_geoid_valid(text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.bca_snapshot_tigerweb_geoid_valid(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-check 408: authenticated and service_role must execute bca_snapshot_tigerweb_geoid_valid';
  END IF;
  SELECT pg_catalog.string_agg(public.bca_snapshot_tigerweb_geoid_valid(v.k, v.g)::text, ',' ORDER BY v.n) INTO answers
  FROM (VALUES (1, 'aiannh', '2430R'), (2, 'aiannh', '12345'), (3, 'cousub', '3901386926'), (4, 'cousub', '390138692'),
               (5, 'city', '0644000'), (6, 'city', '06440'), (7, 'bogus', '06113')) AS v(n, k, g);
  IF answers IS DISTINCT FROM 'true,false,true,false,true,false,false' THEN
    RAISE EXCEPTION 'post-check 408: GEOID helper answered %', answers;
  END IF;
  -- allowed_differences.json lets this function's whole catalog key differ
  -- between the restored copy and hosted, for its ACL order. The key also
  -- carries the owner, so the owner is checked here instead.
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO owner_name FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.bca_snapshot_tigerweb_geoid_valid(text,text)'::regprocedure;
  IF owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'post-check 408: bca_snapshot_tigerweb_geoid_valid is owned by %, expected postgres', owner_name;
  END IF;
END
$check$;

-- PR 409, file 20261102110000: reserve_ai_usage is SECURITY INVOKER with its
-- own search_path and lock_timeout, and only the service role executes it.
DO $check$
DECLARE r record;
BEGIN
  SELECT p.prosecdef, p.proconfig,
         pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authn_x,
         pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x,
         pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS pub_x
    INTO r FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.reserve_ai_usage(uuid,text[],integer,integer,text,text,text,jsonb)'::regprocedure;
  IF r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=""', 'lock_timeout=5s']::text[]
     OR r.anon_x OR r.authn_x OR NOT r.svc_x OR r.pub_x THEN
    RAISE EXCEPTION 'post-check 409: reserve_ai_usage is secdef %, config %, EXECUTE anon % authenticated % service_role % public %',
      r.prosecdef, r.proconfig, r.anon_x, r.authn_x, r.svc_x, r.pub_x;
  END IF;
END
$check$;

-- PR 409, file 20261102110100: the export register's two nullable custody
-- columns, both CHECKs validated, grants unchanged, no row filled yet.
DO $check$
DECLARE cols text; cons text; n bigint;
BEGIN
  SELECT pg_catalog.string_agg(col.column_name || ':' || col.data_type || ':' || col.is_nullable, ',' ORDER BY col.column_name) INTO cols
    FROM information_schema.columns col
   WHERE col.table_schema = 'public' AND col.table_name = 'funding_opportunity_application_exports'
     AND col.column_name IN ('sha256', 'appendix_manifest_json');
  IF cols IS DISTINCT FROM 'appendix_manifest_json:jsonb:YES,sha256:text:YES' THEN
    RAISE EXCEPTION 'post-check 409: export custody columns are %', cols;
  END IF;
  SELECT pg_catalog.string_agg(con.conname || ':' || con.convalidated::text, ',' ORDER BY con.conname) INTO cons
    FROM pg_catalog.pg_constraint con
   WHERE con.conrelid = 'public.funding_opportunity_application_exports'::regclass
     AND con.conname IN ('fo_application_exports_sha256_format', 'fo_application_exports_appendix_manifest_array');
  IF cons IS DISTINCT FROM 'fo_application_exports_appendix_manifest_array:true,fo_application_exports_sha256_format:true' THEN
    RAISE EXCEPTION 'post-check 409: export custody constraints are %', cons;
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.funding_opportunity_application_exports', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.funding_opportunity_application_exports', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.funding_opportunity_application_exports', 'DELETE')
     OR NOT pg_catalog.has_column_privilege('authenticated', 'public.funding_opportunity_application_exports', 'sha256', 'INSERT') THEN
    RAISE EXCEPTION 'post-check 409: authenticated privileges on the export register changed';
  END IF;
  SELECT pg_catalog.count(*) INTO n FROM public.funding_opportunity_application_exports e
   WHERE e.sha256 IS NOT NULL OR e.appendix_manifest_json IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'post-check 409: % export rows already carry custody values', n;
  END IF;
END
$check$;

-- PR 410, file 20261102120000: six RESTRICTIVE writer policies for
-- authenticated, each calling the helper; the helper executable by
-- authenticated only; row security enabled on both tables (restrictive
-- policies do nothing without it) and not forced (the migration relies on the
-- owner-run SECURITY DEFINER writer bill_contract_actuals bypassing it).
DO $check$
DECLARE pols text; r record; rls text; n bigint;
BEGIN
  SELECT pg_catalog.string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text, ',' ORDER BY c.relname) INTO rls
    FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.client_invoices'::regclass, 'public.client_invoice_line_items'::regclass);
  IF rls IS DISTINCT FROM 'client_invoice_line_items:true:false,client_invoices:true:false' THEN
    RAISE EXCEPTION 'post-check 410: row security (table:enabled:forced) is %', rls;
  END IF;
  SELECT pg_catalog.string_agg(p.tablename || '.' || p.policyname || ':' || p.permissive || ':' || p.cmd || ':' || p.roles::text, ';'
                               ORDER BY p.tablename, p.policyname) INTO pols
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.policyname LIKE '%\_invoice\_writer\_%';
  IF pols IS DISTINCT FROM
     'client_invoice_line_items.client_invoice_line_items_invoice_writer_delete:RESTRICTIVE:DELETE:{authenticated};'
     'client_invoice_line_items.client_invoice_line_items_invoice_writer_insert:RESTRICTIVE:INSERT:{authenticated};'
     'client_invoice_line_items.client_invoice_line_items_invoice_writer_update:RESTRICTIVE:UPDATE:{authenticated};'
     'client_invoices.client_invoices_invoice_writer_delete:RESTRICTIVE:DELETE:{authenticated};'
     'client_invoices.client_invoices_invoice_writer_insert:RESTRICTIVE:INSERT:{authenticated};'
     'client_invoices.client_invoices_invoice_writer_update:RESTRICTIVE:UPDATE:{authenticated}' THEN
    RAISE EXCEPTION 'post-check 410: invoice writer policies are %', pols;
  END IF;
  SELECT pg_catalog.count(DISTINCT pol.oid) INTO n FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = pol.oid
   WHERE pol.polrelid IN ('public.client_invoices'::regclass, 'public.client_invoice_line_items'::regclass)
     AND pol.polname LIKE '%\_invoice\_writer\_%'
     AND d.refclassid = 'pg_catalog.pg_proc'::regclass
     AND d.refobjid = 'public.workspace_member_can_write_invoices(uuid)'::regprocedure;
  IF n <> 6 THEN
    RAISE EXCEPTION 'post-check 410: % of the six invoice writer policies call workspace_member_can_write_invoices', n;
  END IF;
  SELECT p.prosecdef,
         pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authn_x,
         pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
    INTO r FROM pg_catalog.pg_proc p WHERE p.oid = 'public.workspace_member_can_write_invoices(uuid)'::regprocedure;
  IF r.prosecdef OR NOT r.authn_x OR r.anon_x OR r.svc_x THEN
    RAISE EXCEPTION 'post-check 410: workspace_member_can_write_invoices is secdef %, EXECUTE authenticated % anon % service_role %',
      r.prosecdef, r.authn_x, r.anon_x, r.svc_x;
  END IF;
END
$check$;

-- PR 415, file 20261102130000: eleven triggers on the two crash tables, none
-- left on the old row functions, the two fences per row and the nine revision
-- and project triggers per statement with their transition tables, no client
-- role executing the new functions, and the acquisition's own fence unchanged.
DO $check$
DECLARE trg text; bad text; fence text;
BEGIN
  SELECT pg_catalog.string_agg(rel.relname || '.' || t.tgname || '=' || p.proname || ':'
                               || CASE WHEN t.tgtype::integer & 1 = 1 THEN 'row' ELSE 'statement' END || ':'
                               || coalesce(t.tgoldtable::text, '-') || ':' || coalesce(t.tgnewtable::text, '-'),
                               ';' ORDER BY rel.relname, t.tgname) INTO trg
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class rel ON rel.oid = t.tgrelid
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid IN ('public.safety_crashes'::regclass, 'public.safety_crash_parties'::regclass) AND NOT t.tgisinternal;
  IF trg IS DISTINCT FROM
     'safety_crash_parties.safety_comparison_party_fence=safety_crash_child_fence:row:-:-;'
     'safety_crash_parties.safety_comparison_party_revision_delete=safety_crash_child_revision:statement:old_rows:-;'
     'safety_crash_parties.safety_comparison_party_revision_insert=safety_crash_child_revision:statement:-:new_rows;'
     'safety_crash_parties.safety_comparison_party_revision_update=safety_crash_child_revision:statement:old_rows:new_rows;'
     'safety_crashes.safety_comparison_crash_fence=safety_crash_child_fence:row:-:-;'
     'safety_crashes.safety_comparison_crash_revision_delete=safety_crash_child_revision:statement:old_rows:-;'
     'safety_crashes.safety_comparison_crash_revision_insert=safety_crash_child_revision:statement:-:new_rows;'
     'safety_crashes.safety_comparison_crash_revision_update=safety_crash_child_revision:statement:old_rows:new_rows;'
     'safety_crashes.trg_safety_crashes_project_evidence_revision_delete=bump_project_revision_from_safety_crash_rows:statement:old_rows:-;'
     'safety_crashes.trg_safety_crashes_project_evidence_revision_insert=bump_project_revision_from_safety_crash_rows:statement:-:new_rows;'
     'safety_crashes.trg_safety_crashes_project_evidence_revision_update=bump_project_revision_from_safety_crash_rows:statement:old_rows:new_rows' THEN
    RAISE EXCEPTION 'post-check 415: crash and party triggers are %', trg;
  END IF;
  SELECT pg_catalog.string_agg(r.role || ':' || f.fn, ',') INTO bad
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role),
         (VALUES ('public.safety_crash_child_fence()'), ('public.safety_crash_child_revision()'),
                 ('public.bump_project_revision_from_safety_crash_rows()')) AS f(fn)
   WHERE pg_catalog.has_function_privilege(r.role, f.fn, 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'post-check 415: client roles can execute crash trigger functions: %', bad;
  END IF;
  SELECT n.nspname || '.' || p.proname INTO fence FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE t.tgrelid = 'public.safety_crash_ingests'::regclass AND t.tgname = 'safety_comparison_source_fence';
  IF fence IS DISTINCT FROM 'safety_comparison_private.source_fence' THEN
    RAISE EXCEPTION 'post-check 415: the acquisition fence runs %', fence;
  END IF;
END
$check$;

-- PR 440, file 20261102140000: three enabled guard triggers on the right
-- functions, each BEFORE, per row, on the right events and UPDATE OF
-- columns; two SECURITY DEFINER functions with a fixed search_path; no client
-- role executing them.
DO $check$
DECLARE trg text; fns text; bad text;
BEGIN
  SELECT pg_catalog.string_agg(t.tgname || '@' || rel.relname || ':' || t.tgenabled::text || ':' || p.proname || ':'
                               || CASE WHEN t.tgtype::integer & 2 = 2 THEN 'before' ELSE 'after' END
                               || CASE WHEN t.tgtype::integer & 1 = 1 THEN ' row' ELSE ' statement' END
                               || CASE WHEN t.tgtype::integer & 4 = 4 THEN ' insert' ELSE '' END
                               || CASE WHEN t.tgtype::integer & 16 = 16 THEN ' update' ELSE '' END
                               || CASE WHEN t.tgtype::integer & 8 = 8 THEN ' delete' ELSE '' END || ':'
                               || coalesce((SELECT pg_catalog.string_agg(a.attname, ' ' ORDER BY a.attname) FROM pg_catalog.pg_attribute a
                                             WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::smallint[])), '-'),
                               ',' ORDER BY t.tgname) INTO trg
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class rel ON rel.oid = t.tgrelid JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgname IN ('project_rtp_cycle_links_workspace_scope', 'projects_rtp_link_workspace', 'rtp_cycles_rtp_link_workspace');
  IF trg IS DISTINCT FROM
     'project_rtp_cycle_links_workspace_scope@project_rtp_cycle_links:O:guard_project_rtp_cycle_link_scope:before row insert update:evidence_model_run_id horizon_band_id project_id rtp_cycle_id workspace_id,'
     'projects_rtp_link_workspace@projects:O:guard_rtp_link_parent_workspace:before row update:workspace_id,'
     'rtp_cycles_rtp_link_workspace@rtp_cycles:O:guard_rtp_link_parent_workspace:before row update:workspace_id' THEN
    RAISE EXCEPTION 'post-check 440: RTP link guard triggers are %', trg;
  END IF;
  SELECT pg_catalog.string_agg(p.proname || ':' || p.prosecdef::text || ':' || p.proconfig::text, ',' ORDER BY p.proname) INTO fns
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('guard_project_rtp_cycle_link_scope', 'guard_rtp_link_parent_workspace');
  IF fns IS DISTINCT FROM
     'guard_project_rtp_cycle_link_scope:true:{"search_path=pg_catalog, public, pg_temp"},guard_rtp_link_parent_workspace:true:{"search_path=pg_catalog, public, pg_temp"}' THEN
    RAISE EXCEPTION 'post-check 440: RTP link guard functions are %', fns;
  END IF;
  SELECT pg_catalog.string_agg(r.role || ':' || f.fn, ',') INTO bad
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role),
         (VALUES ('public.guard_project_rtp_cycle_link_scope()'), ('public.guard_rtp_link_parent_workspace()')) AS f(fn)
   WHERE pg_catalog.has_function_privilege(r.role, f.fn, 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'post-check 440: client roles can execute RTP link guard functions: %', bad;
  END IF;
END
$check$;

-- All seven files: the definition of every function they create or replace,
-- by SHA-256 of pg_get_functiondef (body, arguments, return type, language,
-- volatility, security and SET clauses; not owner or ACL), and the owner of
-- every function they create. The kit's change map already compares these
-- with the restored copy's dry run; this block states the expected values in
-- the repository, so a wrong body fails here by name. If PostgreSQL ever
-- rendered a definition differently, this block would stop the window and
-- roll it back to 448: reread the hashes on a stand-in at hosted's version
-- before the next attempt.
DO $check$
DECLARE r record; bad text := '';
BEGIN
  FOR r IN
    SELECT f.pr, f.fn, f.expected, f.created,
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(f.fn::regprocedure), 'UTF8')), 'hex') AS found,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
      FROM (VALUES
        ('408', 'public.bca_snapshot_tigerweb_geoid_valid(text,text)', '31b3278136f300b202d58cb8a5ccc0225544d33edbc1a37233e98857570f05ca', true),
        ('408', 'public.valid_bca_snapshot_jurisdiction(jsonb)', '1a35b84a8d70b42e647ad0796ee0d228818b04852a77972a7888e766af09a3b0', false),
        ('408', 'public.guard_project_bca_place_insert()', '482593e452cb117938813a42227f8a94580ff1d2e5cbeee1fe729aebc0c72981', false),
        ('409', 'public.reserve_ai_usage(uuid,text[],integer,integer,text,text,text,jsonb)', '75d4e48636bc396e0b948618452186414068d319168c0927a7390b7e4c9cdd3f', true),
        ('410', 'public.workspace_member_can_write_invoices(uuid)', 'a6f6cd2fe9beca8bcfe341d84af776569d50a4d431bef34b2af29e8eb1738c75', true),
        ('415', 'public.safety_crash_child_fence()', '3b686e2d912644cf4a0259cf6b8172403e4bc8415e67dded112796a318c0ef12', true),
        ('415', 'public.safety_crash_child_revision()', '4247cbf23855006caa9bba517fb82512e4ccc0e22ea38a396c622e69736097cf', true),
        ('415', 'public.bump_project_revision_from_safety_crash_rows()', '9c901ead1dee5aa62cea5617069c6581aea870e47fbd45b1a2032f434953ebb3', true),
        ('440', 'public.guard_project_rtp_cycle_link_scope()', 'd5bdbccfca8a9059b55e4fdfa5b9b054f8bb00e0ac15099e046b2e228f5b832e', true),
        ('440', 'public.guard_rtp_link_parent_workspace()', 'f5300e3a1fc37c1ce4771d3985a1b562f4d25e4e5434818da061768413d81374', true)
      ) AS f(pr, fn, expected, created)
      JOIN pg_catalog.pg_proc p ON p.oid = f.fn::regprocedure
  LOOP
    IF r.found IS DISTINCT FROM r.expected THEN
      bad := bad || pg_catalog.format(' %s %s definition %s;', r.pr, r.fn, r.found);
    END IF;
    IF r.created AND r.owner_name IS DISTINCT FROM 'postgres' THEN
      bad := bad || pg_catalog.format(' %s %s owned by %s;', r.pr, r.fn, r.owner_name);
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'post-check functions:%', bad;
  END IF;
END
$check$;
