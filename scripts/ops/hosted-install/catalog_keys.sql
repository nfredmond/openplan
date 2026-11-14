-- Catalog key reader for the hosted install kit (review 15, B3).
--
-- One SELECT returning (k, v): a stable key per catalog object and the object's
-- full value as text. The kit hashes v with md5 and compares the key-to-hash
-- map, so a key that changes to the wrong value fails, not only a key that
-- appears. Keys never contain OIDs, so two databases with the same objects
-- produce the same map.
--
-- The caller sets search_path to pg_catalog, pg_temp before running it, so
-- every rendered name is schema-qualified and the map does not depend on the
-- session's search_path. The query reads only catalogs and works in a READ
-- ONLY transaction.
--
-- Covered, in every schema except pg_catalog, information_schema, pg_toast and
-- the temporary schemas: schemas; relations (kind, owner, ACL, RLS, force RLS,
-- options); columns (type, typmod, not null, default, identity, generated,
-- collation, column ACL); constraints (definition, validated, deferrable);
-- indexes (definition, valid); functions (definition hash, owner, ACL,
-- proconfig, security definer, volatility, leakproof, parallel, kind); triggers
-- (full definition, including UPDATE OF columns and transition tables, and
-- enabled state); policies (permissive, roles, command, USING, WITH CHECK);
-- views and materialized views (definition); types (kind, owner, ACL, enum
-- labels, domain base and default); sequences (parameters, owning column, not
-- the current value); rules; extended statistics definitions; operators,
-- operator classes and families, collations, conversions and text search
-- objects (existence and owner); comments; default privileges; event
-- triggers; publications and their tables; extensions and their members;
-- user-defined casts; foreign data wrappers and servers; roles (attributes and
-- settings, never passwords) and role memberships; and
-- supabase_migrations.schema_migrations rows (version, name, md5 of
-- statements).
--
-- Excluded, each with its reason:
--   * roles named cli_login_%: the Supabase CLI recreates its login role and
--     its expiry on every linked call (finding F11). The kit itself never makes
--     one, but another operator's CLI call must not stop a window.
--   * rolvaliduntil, rolpassword: churn and secrets, not structure.
--   * table statistics, sequence current values, row data: data, not catalog.
--   * the database object and its settings: not changed by a migration file.
WITH ns AS (
  SELECT oid, nspname FROM pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND nspname NOT LIKE 'pg\_temp\_%' AND nspname NOT LIKE 'pg\_toast\_temp\_%'
), rel AS (
  SELECT c.*, ns.nspname, quote_ident(ns.nspname) || '.' || quote_ident(c.relname) AS qname
  FROM pg_class c JOIN ns ON ns.oid = c.relnamespace
), fn AS (
  SELECT p.*, ns.nspname,
         quote_ident(ns.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS ident
  FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace
)
SELECT 'schema:' || quote_ident(n.nspname) AS k,
       jsonb_build_array(pg_get_userbyid(n.nspowner), n.nspacl)::text AS v
FROM pg_namespace n JOIN ns ON ns.oid = n.oid
UNION ALL
SELECT 'rel:' || r.qname,
       jsonb_build_array(r.relkind, pg_get_userbyid(r.relowner), r.relacl, r.relrowsecurity,
                         r.relforcerowsecurity, r.relpersistence, r.relispartition, r.reloptions,
                         CASE WHEN r.relispartition THEN pg_get_expr(r.relpartbound, r.oid) END)::text
FROM rel r WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
UNION ALL
SELECT 'col:' || r.qname || '.' || quote_ident(a.attname),
       jsonb_build_array(format_type(a.atttypid, a.atttypmod), a.attnotnull,
                         pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated,
                         CASE WHEN a.attcollation <> 0 THEN (SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
                              FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace WHERE co.oid = a.attcollation) END,
                         a.attacl, a.attnum)::text
FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f', 'c') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con:' || COALESCE(r.qname, (SELECT quote_ident(tn.nspname) || '.' || quote_ident(t.typname)
                                    FROM pg_type t JOIN pg_namespace tn ON tn.oid = t.typnamespace WHERE t.oid = c.contypid))
       || '.' || quote_ident(c.conname),
       jsonb_build_array(c.contype, pg_get_constraintdef(c.oid), c.convalidated, c.condeferrable, c.condeferred)::text
FROM pg_constraint c JOIN ns ON ns.oid = c.connamespace
LEFT JOIN rel r ON r.oid = c.conrelid
UNION ALL
SELECT 'idx:' || r.qname,
       jsonb_build_array(pg_get_indexdef(i.indexrelid), i.indisvalid, i.indisprimary, i.indisunique,
                         pg_get_userbyid(r.relowner))::text
FROM rel r JOIN pg_index i ON i.indexrelid = r.oid
UNION ALL
SELECT 'fn:' || f.ident,
       jsonb_build_array(f.prokind,
                         CASE WHEN f.prokind = 'a'
                              THEN md5(jsonb_build_array(pg_get_function_result(f.oid),
                                       (SELECT jsonb_build_array(ag.aggtransfn::text, ag.aggfinalfn::text, ag.aggcombinefn::text,
                                                                 format_type(ag.aggtranstype, NULL), ag.agginitval)
                                        FROM pg_aggregate ag WHERE ag.aggfnoid = f.oid))::text)
                              ELSE md5(pg_get_functiondef(f.oid)) END,
                         pg_get_userbyid(f.proowner), f.proacl, f.proconfig, f.prosecdef,
                         f.provolatile, f.proleakproof, f.proparallel)::text
FROM fn f
UNION ALL
SELECT 'trg:' || r.qname || '.' || quote_ident(t.tgname),
       jsonb_build_array(pg_get_triggerdef(t.oid), t.tgenabled)::text
FROM pg_trigger t JOIN rel r ON r.oid = t.tgrelid
WHERE NOT t.tgisinternal
UNION ALL
SELECT 'pol:' || r.qname || '.' || quote_ident(p.polname),
       jsonb_build_array(p.polpermissive, p.polcmd,
                         (SELECT jsonb_agg(CASE WHEN x = 0 THEN 'public' ELSE pg_get_userbyid(x) END ORDER BY 1)
                          FROM unnest(p.polroles) x),
                         pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))::text
FROM pg_policy p JOIN rel r ON r.oid = p.polrelid
UNION ALL
SELECT 'view:' || r.qname, jsonb_build_array(pg_get_viewdef(r.oid))::text
FROM rel r WHERE r.relkind IN ('v', 'm')
UNION ALL
SELECT 'type:' || quote_ident(ns.nspname) || '.' || quote_ident(t.typname),
       jsonb_build_array(t.typtype, pg_get_userbyid(t.typowner), t.typacl,
                         CASE WHEN t.typtype = 'e' THEN (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
                                                         FROM pg_enum e WHERE e.enumtypid = t.oid) END,
                         CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END,
                         t.typnotnull, t.typdefault)::text
FROM pg_type t JOIN ns ON ns.oid = t.typnamespace
WHERE t.typelem = 0 OR t.typcategory <> 'A'
UNION ALL
SELECT 'seq:' || r.qname,
       jsonb_build_array(format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmax, s.seqmin,
                         s.seqcache, s.seqcycle,
                         (SELECT quote_ident(on_.nspname) || '.' || quote_ident(oc.relname) || '.' || quote_ident(oa.attname)
                          FROM pg_depend dep JOIN pg_class oc ON oc.oid = dep.refobjid
                          JOIN pg_namespace on_ ON on_.oid = oc.relnamespace
                          JOIN pg_attribute oa ON oa.attrelid = dep.refobjid AND oa.attnum = dep.refobjsubid
                          WHERE dep.classid = 'pg_class'::regclass AND dep.objid = r.oid
                            AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
                          LIMIT 1))::text
FROM rel r JOIN pg_sequence s ON s.seqrelid = r.oid
UNION ALL
SELECT 'rule:' || r.qname || '.' || quote_ident(rw.rulename), jsonb_build_array(pg_get_ruledef(rw.oid), rw.ev_enabled)::text
FROM pg_rewrite rw JOIN rel r ON r.oid = rw.ev_class
WHERE rw.rulename <> '_RETURN'
UNION ALL
SELECT 'stx:' || quote_ident(ns.nspname) || '.' || quote_ident(x.stxname),
       jsonb_build_array(pg_get_statisticsobjdef(x.oid), pg_get_userbyid(x.stxowner))::text
FROM pg_statistic_ext x JOIN ns ON ns.oid = x.stxnamespace
UNION ALL
SELECT 'obj:' || o.type || ':' || o.identity, jsonb_build_array(o.owner)::text
FROM (
  SELECT (pg_identify_object('pg_operator'::regclass, x.oid, 0)).*, pg_get_userbyid(x.oprowner) AS owner
  FROM pg_operator x JOIN ns ON ns.oid = x.oprnamespace
  UNION ALL
  SELECT (pg_identify_object('pg_opclass'::regclass, x.oid, 0)).*, pg_get_userbyid(x.opcowner)
  FROM pg_opclass x JOIN ns ON ns.oid = x.opcnamespace
  UNION ALL
  SELECT (pg_identify_object('pg_opfamily'::regclass, x.oid, 0)).*, pg_get_userbyid(x.opfowner)
  FROM pg_opfamily x JOIN ns ON ns.oid = x.opfnamespace
  UNION ALL
  SELECT (pg_identify_object('pg_collation'::regclass, x.oid, 0)).*, pg_get_userbyid(x.collowner)
  FROM pg_collation x JOIN ns ON ns.oid = x.collnamespace
  UNION ALL
  SELECT (pg_identify_object('pg_conversion'::regclass, x.oid, 0)).*, pg_get_userbyid(x.conowner)
  FROM pg_conversion x JOIN ns ON ns.oid = x.connamespace
  UNION ALL
  SELECT (pg_identify_object('pg_ts_config'::regclass, x.oid, 0)).*, pg_get_userbyid(x.cfgowner)
  FROM pg_ts_config x JOIN ns ON ns.oid = x.cfgnamespace
  UNION ALL
  SELECT (pg_identify_object('pg_ts_dict'::regclass, x.oid, 0)).*, pg_get_userbyid(x.dictowner)
  FROM pg_ts_dict x JOIN ns ON ns.oid = x.dictnamespace
) o
UNION ALL
SELECT 'comment:' || o.type || ':' || o.identity, jsonb_build_array(d.description)::text
FROM pg_description d
CROSS JOIN LATERAL pg_identify_object(d.classoid, d.objoid, d.objsubid) o
WHERE (o.schema IS NULL AND o.type IN ('schema', 'extension', 'event trigger', 'publication', 'role',
                                       'foreign-data wrapper', 'server', 'cast'))
   OR (o.schema IS NOT NULL AND o.schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND o.schema NOT LIKE 'pg\_temp\_%' AND o.schema NOT LIKE 'pg\_toast\_temp\_%')
UNION ALL
SELECT 'defacl:' || pg_get_userbyid(da.defaclrole) || ':' || COALESCE(quote_ident(n.nspname), '*') || ':' || da.defaclobjtype::text,
       jsonb_build_array(da.defaclacl)::text
FROM pg_default_acl da LEFT JOIN pg_namespace n ON n.oid = da.defaclnamespace
UNION ALL
SELECT 'evt:' || quote_ident(e.evtname),
       jsonb_build_array(e.evtevent, pg_get_userbyid(e.evtowner), e.evtfoid::regprocedure::text, e.evtenabled, e.evttags)::text
FROM pg_event_trigger e
UNION ALL
SELECT 'pub:' || quote_ident(p.pubname),
       jsonb_build_array(pg_get_userbyid(p.pubowner), p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete,
                         p.pubtruncate, p.pubviaroot)::text
FROM pg_publication p
UNION ALL
SELECT 'pubrel:' || quote_ident(p.pubname) || ':' || quote_ident(pt.schemaname) || '.' || quote_ident(pt.tablename),
       jsonb_build_array(pt.attnames, pt.rowfilter)::text
FROM pg_publication p JOIN pg_publication_tables pt ON pt.pubname = p.pubname
UNION ALL
SELECT 'ext:' || quote_ident(x.extname),
       jsonb_build_array(x.extversion, x.extnamespace::regnamespace::text, pg_get_userbyid(x.extowner), x.extrelocatable)::text
FROM pg_extension x
UNION ALL
SELECT 'extmember:' || quote_ident(x.extname) || ':' || o.type || ':' || o.identity, '[]'
FROM pg_depend d JOIN pg_extension x ON x.oid = d.refobjid
CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
WHERE d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
UNION ALL
SELECT 'cast:' || format_type(c.castsource, NULL) || '->' || format_type(c.casttarget, NULL),
       jsonb_build_array(CASE WHEN c.castfunc <> 0 THEN c.castfunc::regprocedure::text END, c.castcontext, c.castmethod)::text
FROM pg_cast c WHERE c.oid >= 16384
UNION ALL
SELECT 'fdw:' || quote_ident(w.fdwname), jsonb_build_array(pg_get_userbyid(w.fdwowner), w.fdwacl, w.fdwoptions)::text
FROM pg_foreign_data_wrapper w
UNION ALL
SELECT 'server:' || quote_ident(s.srvname), jsonb_build_array(pg_get_userbyid(s.srvowner), s.srvacl, s.srvtype, s.srvversion)::text
FROM pg_foreign_server s
UNION ALL
SELECT 'role:' || quote_ident(r.rolname),
       jsonb_build_array(r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin,
                         r.rolreplication, r.rolbypassrls, r.rolconnlimit, r.rolconfig)::text
FROM pg_roles r WHERE r.rolname NOT LIKE 'cli\_login\_%'
UNION ALL
SELECT 'member:' || quote_ident(pg_get_userbyid(m.roleid)) || ':' || quote_ident(pg_get_userbyid(m.member))
       || ':' || quote_ident(pg_get_userbyid(m.grantor)),
       jsonb_build_array(m.admin_option, m.inherit_option, m.set_option)::text
FROM pg_auth_members m
WHERE pg_get_userbyid(m.roleid) NOT LIKE 'cli\_login\_%' AND pg_get_userbyid(m.member) NOT LIKE 'cli\_login\_%'
UNION ALL
SELECT 'hist:' || h.version, jsonb_build_array(h.name, md5(COALESCE(h.statements::text, '')))::text
FROM supabase_migrations.schema_migrations h
