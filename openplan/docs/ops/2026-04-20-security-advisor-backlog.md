# Security-advisor backlog — scoping doc (2026-04-20)

## Why this doc exists

The NCTC demo workspace went live on prod Supabase (`aggphdqkanxsfzzoxlbk`) on 2026-04-19 late session. Before the first **external** customer touches the system, the Supabase security advisor backlog needs to be inventoried, triaged, and closed in two waves: (1) mechanical hardening we can ship now, (2) design calls that need an explicit posture decision before becoming code.

This is a scoping doc, not a proof doc — nothing ships from this file directly. Each "easy win" becomes its own migration slice; each "design call" becomes its own decision doc.

**Source of truth:** `mcp__supabase__get_advisors(type=security)` against project `aggphdqkanxsfzzoxlbk`, run 2026-04-20. Re-run before closing any item.

## Current advisor snapshot

| Level | Count | Category |
|---|---|---|
| ERROR | 3 | 2 SECURITY DEFINER views + 1 RLS-disabled system table |
| WARN | 37 | 34 mutable `search_path` functions + 2 extensions in public + 1 auth config |
| INFO | 11 | RLS enabled, no policy (10 public-data tables + 1 billing table) |

Net change since Phase Q.4 migration (`20260420000060_report_artifacts_bucket.sql`) applied live: **zero regressions**. The new bucket's two RLS policies are compliant.

---

## Wave 1 — easy wins (ship before first external customer)

### W1.1 — Fix mutable `search_path` on 34 trigger/validator functions *(WARN × 34)*

**Advisor lint:** `function_search_path_mutable` ([docs](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable))

**Fix pattern:** append `SET search_path = public, pg_temp` to each function definition. This pins lookup order so a malicious role can't shadow a built-in via a schema they've planted earlier in the path. All 34 are internal DML/validator helpers (trigger bodies, `CHECK` predicates, `touch_*` cross-table updaters) — no public-facing side effects.

**Full list (grouped by migration file):**

| Migration | Functions |
|---|---|
| `20260313000011_projects_module.sql` | `set_projects_updated_at` |
| `20260313000012_project_subrecords.sql` | `set_project_subrecord_updated_at` |
| `20260313000014_data_hub_module.sql` | `set_data_hub_updated_at` |
| `20260314000018_reports_module.sql` | `set_reports_updated_at` |
| `20260314000019_scenarios_module.sql` | `set_scenarios_updated_at`, `validate_scenario_spine_entry`, `sync_scenario_set_baseline_entry`, `refresh_scenario_set_baseline_entry`, `validate_scenario_set_baseline_entry` |
| `20260314000020_engagement_module.sql` | `set_engagement_updated_at`, `validate_engagement_item_category` |
| `20260315000021_plans_module.sql` | `set_plans_updated_at`, `touch_plan_updated_at_from_links` |
| `20260315000022_programs_module.sql` | `set_programs_updated_at`, `touch_program_updated_at_from_links`, `touch_program_updated_at_from_funding_opportunities` |
| `20260315000023_models_module.sql` | `set_models_updated_at`, `touch_model_updated_at_from_links` |
| `20260317000025_model_runs_module.sql` | `set_model_runs_updated_at`, `touch_model_updated_at_from_model_runs` |
| `20260318000026_model_run_stages_and_artifacts.sql` | `set_model_run_stages_updated_at`, `set_model_run_artifacts_updated_at` |
| `20260318000027_network_packages_schema.sql` | `set_network_packages_updated_at`, `set_network_package_versions_updated_at` |
| `20260324000134_county_onramp_runs.sql` | `set_county_runs_updated_at` |
| `20260226000008_billing_webhook_receipts.sql` | `set_billing_webhook_receipts_updated_at` |
| `20260409000035_rtp_cycles_module.sql` | `set_rtp_cycles_updated_at` |
| `20260409000037_rtp_cycle_chapters.sql` | `set_rtp_cycle_chapters_updated_at`, `seed_default_rtp_cycle_chapters` |
| `20260410000041_funding_opportunities.sql` | `set_funding_opportunities_updated_at` |
| `20260410000043_funding_awards_and_profiles.sql` | `set_funding_awards_updated_at`, `set_project_funding_profiles_updated_at` |
| `20260410000046_scenario_comparison_snapshots.sql` | `validate_scenario_comparison_snapshot`, `validate_scenario_comparison_indicator_delta` |

**Ship as:** one migration `supabase/migrations/<ts>_pin_function_search_path.sql` containing `ALTER FUNCTION public.<name>() SET search_path = public, pg_temp;` for each. Idempotent (`ALTER FUNCTION ... SET` is safe to re-run). No behavior change, zero risk.

**Effort:** ~30 min to write, ~5 min to review. One slice.

---

### W1.2 — RLS policies for public GTFS + Census/LODES tables *(INFO × 10)*

**Advisor lint:** `rls_enabled_no_policy` on `agencies`, `calendar`, `calendar_dates`, `census_tracts`, `lodes_od`, `routes`, `shapes`, `stop_times`, `stops`, `trips`.

**Current state:** RLS is ON at the DB level (Supabase auto-enabled on table creation) but the migration files never added policies. Result: PostgREST blocks all direct reads. The AI query pipeline bypasses this because `execute_safe_query` is `SECURITY DEFINER` and executes as table-owner — **functional today**, but:

- Any future code path that hits these tables directly via the Supabase JS client will silently get zero rows.
- Direct PostgREST access (e.g., `supabase.from("stops").select("*")`) is blocked for all users including service-role-scoped code (service-role bypasses RLS but this would still surprise a debugger who expects data to appear).
- `CLAUDE.md` documents "Public GTFS feeds have `workspace_id IS NULL` and are readable by anyone" — this is true for `gtfs_feeds` (which does have a policy) but not for the child tables. The doc describes intent; the DB enforces the opposite.

**Fix pattern:** permissive SELECT-anyone policies on each, matching the stated intent:

```sql
CREATE POLICY "public_read_<table>" ON public.<table>
  FOR SELECT USING (true);
```

**Why this is safe:** every row in these tables is already "public" in the business sense — GTFS feeds + ACS Census + LODES employment are all CC-0 or public-domain data. The value of the platform *is* that anyone can query them. Nothing here is workspace-scoped.

**Ship as:** one migration `<ts>_public_gtfs_census_select_policies.sql` — 10 `CREATE POLICY IF NOT EXISTS` blocks + a `COMMENT ON POLICY` on each citing this doc.

**Effort:** ~20 min. Second slice.

---

### W1.3 — Enable RLS + lock down `spatial_ref_sys` *(ERROR × 1)*

**Advisor lint:** `rls_disabled_in_public` on `public.spatial_ref_sys`.

**Context:** `spatial_ref_sys` is a PostGIS system table (EPSG codes, projection metadata). It's owned by `supabase_admin`, not the migration role — direct `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY` will fail with "must be owner."

**Two fixes ranked:**

1. **Preferred:** Supabase dashboard → Database → Tables → `spatial_ref_sys` → Enable RLS (button-clickable because the dashboard runs as admin), then add a permissive SELECT-anyone policy. This table is safe to read (it's just projection metadata) and is read by PostGIS functions on every spatial query.
2. **Fallback:** Move PostGIS out of `public` (see W2.1 below) — `spatial_ref_sys` relocates with the extension and the advisor entry disappears. Breaking change.

**Ship as:** manual dashboard step + a note in the proof doc explaining why this isn't in a migration file. One minute of clicks.

**Effort:** 5 min including verification.

---

### W1.4 — Enable leaked-password protection on Auth *(WARN × 1)*

**Advisor lint:** `auth_leaked_password_protection`.

**Fix:** Supabase dashboard → Authentication → Policies → enable "Leaked Password Protection" (HaveIBeenPwned API check at signup/password-change).

**Why now:** zero code, zero risk, improves default posture against credential stuffing. External customers will expect this. No UX change for users choosing strong passwords; known-compromised-password users hit a sign-up error with a HIBP-linked explanation.

**Effort:** 2 min including verification.

---

### W1.5 — Policy for `billing_webhook_receipts` *(INFO × 1)*

**Advisor lint:** `rls_enabled_no_policy` on `public.billing_webhook_receipts`.

**Context:** This table stores raw Stripe webhook payloads. RLS is on, no policy → correctly blocks all user access. Only the service-role key (used by the webhook handler) can write/read, which is the intended posture.

**Fix options:**

1. **Do nothing** — the current "no policy = deny all for users, service-role bypasses RLS" posture is intentional and secure. The INFO-level advisor entry is cosmetic.
2. **Add an explicit deny-all policy** with a comment explaining this is by design:
   ```sql
   COMMENT ON TABLE billing_webhook_receipts IS
     'Service-role only. No RLS policy by design — user roles must never see raw webhook payloads.';
   ```
   This silences the advisor without adding attack surface.

**Recommendation:** ship option 2. Silences the advisor, makes intent explicit in the schema, and matches the precedent of the other explicitly-denied tables.

**Effort:** 5 min, fold into the W1.1 migration.

---

## Wave 2 — design calls (need explicit posture before code)

### W2.1 — SECURITY DEFINER views `lodes_by_tract` + `census_tracts_computed` *(ERROR × 2)*

**Advisor lint:** `security_definer_view` on both.

**What SECURITY DEFINER does on a view:** the view executes with the creator's privileges regardless of who queries it. For views over **public** data this is harmless in practice — the underlying tables are readable-by-everyone anyway. For views over **private** data it's a privilege-escalation footgun. Both views here aggregate public data (LODES jobs by tract, Census tracts with computed demographics), so the posture is "ERROR by pattern, acceptable in practice."

**Three options:**

1. **Drop SECURITY DEFINER** (recreate as `SECURITY INVOKER`). Breaks current functionality because RLS on the underlying `lodes_od` / `census_tracts` tables currently blocks non-service-role reads (see W1.2 — solve that first, then this becomes a clean drop).
2. **Keep SECURITY DEFINER, silence the advisor** via `COMMENT ON VIEW ... IS 'justification'` or a whitelist file. Advisor still flags; no code impact.
3. **Keep SECURITY DEFINER as a conscious choice** and document the rationale here without silencing the advisor. Auditors see the ERROR; we point them at this doc.

**Dependency:** W1.2 must ship first, otherwise option 1 breaks the AI query pipeline's tract-level aggregations.

**Recommendation:** ship W1.2, then take option 1 (drop SECURITY DEFINER). One slice after the Wave-1 policy migration lands.

**Effort:** 30 min + careful end-to-end test of `/api/chat` against tract-aggregated LODES queries.

---

### W2.2 — Move PostGIS + pg_trgm out of `public` *(WARN × 2)*

**Advisor lint:** `extension_in_public` on `postgis`, `pg_trgm`.

**Why advisor flags it:** extensions in the `public` schema can shadow user functions and are visible in default search paths. The recommendation is to move them into their own schema (`extensions` is the Supabase convention).

**Why it's not a Wave-1 item:** moving PostGIS is a **breaking change** for any code that references `geometry`, `ST_AsGeoJSON`, `ST_DWithin`, etc. without a schema qualifier. Our entire AI query pipeline, every `*.sql` migration with a `geometry` column, and external documentation generated from the schema would need updating. Supabase themselves left PostGIS in `public` on project creation for this exact reason.

**Three options:**

1. **Leave both extensions in `public`**, document the rationale (this doc), accept the WARN-level advisor entries as known tradeoffs. The common pattern for Supabase + PostGIS projects.
2. **Move to `extensions` schema** + update every spatial reference in code + migrations + `execute_safe_query` to qualify with `extensions.<func>`. Weeks of mechanical work + high regression risk.
3. **Move only `pg_trgm`** (fewer references). Partial advisor silence, partial mitigation.

**Recommendation:** option 1. Accept the posture, document here. Revisit only if an auditor blocks us on it.

**Effort (option 1):** 10 min to append an acknowledged-risk section to this doc.

---

## Wave 3 — acknowledged, not fixing

Items the advisor will keep flagging that we've explicitly accepted:

- **`extension_in_public` for `postgis` + `pg_trgm`** — see W2.1. Cost/benefit doesn't justify the breaking change.
- **`rls_enabled_no_policy` for `billing_webhook_receipts`** — see W1.5. Closed via `COMMENT ON TABLE` once W1.1 ships; advisor may still flag, but intent is documented in the schema.

---

## Suggested execution order

1. **W1.4** (dashboard toggle: leaked-password protection) — zero code, 2 min
2. **W1.3** (dashboard: enable RLS on `spatial_ref_sys`) — 5 min
3. **W1.1 + W1.5** combined migration (pin 34 function search paths + document `billing_webhook_receipts`) — ~35 min slice
4. **W1.2** migration (10 public-read policies) — ~20 min slice
5. **W2.1** migration (drop SECURITY DEFINER from the 2 views) — depends on W1.2 landing first; ~30 min + integration test
6. **W2.2 option 1** — append acknowledged-risk section; no code

After steps 1–5, re-run `mcp__supabase__get_advisors(type=security)`. Expected result: zero ERRORs, zero function-search-path WARNs, zero RLS-no-policy INFOs. Remaining WARNs: `postgis` + `pg_trgm` in public (accepted).

## Verification after each slice

- `pnpm exec tsc --noEmit` — no code changes in SQL-only slices, but sanity-check anyway.
- `pnpm test -- --run` — full suite must stay at 806/172.
- `mcp__supabase__get_advisors(type=security)` — diff against this snapshot.
- For W1.2 + W2.1: curl `/api/chat` with a tract-level LODES query locally to confirm the aggregations still return data.

## When to re-open this doc

- New migration lands that touches RLS or creates a function → check advisor, update this doc if new items appear.
- First external customer engagement starts → close all Wave 1 items first.
- Supabase publishes a new lint type → re-triage here before shipping.
