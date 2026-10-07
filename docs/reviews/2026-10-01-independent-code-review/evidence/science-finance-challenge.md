# Independent challenge of finance findings

October 1, 2026. Source baseline `891a0d89a848133d44b9e4f314a76a922cd71ace`. This review reads the parent reviewer's reproduction scripts/results and source. It makes no database calls and does not independently rerun the parent's native fixture.

## Work-program pagination

The result is supported, conditional on the response cap. `reportingRows` requests 200 rows, advances by 200 and treats any response shorter than 200 as final at `reporting-server.ts:11-20`. The extracted function in `financial-repro.cjs` is the production function, not a handwritten copy. Its mock answers a successful response containing the first 50 rows while 250 exist, reproducing what a server cap of 50 would return. The function returns 50 after one request. The 1,000-cap control returns all 250.

This is a demonstrated algorithm defect under the stated cap, not a demonstrated loss on the default deployment. `openplan/supabase/config.toml:14` sets `max_rows = 1000`, above the requested 200. Keep this condition in severity and final wording. No native server reconfiguration, issued-report loss or browser effect was independently established.

Correction should either enforce and verify a deployment minimum, or make pagination independent of the server cap. Continuing until an empty page requires advancing by the actual returned count, not 200. Keyset pagination over stable IDs can avoid that offset assumption. Snapshot/cutoff consistency needs its own consideration for mutable source tables. Regression should use 250 synthetic rows with caps 50, 199 and 200, an exact full-page multiple, an empty source and an error after a successful prefix. A query error must not return a partial ledger. The current no-op and removed-rows counterexample show that the reproduction observes result content, but do not prove real PostgREST behavior.

## Wrong-fund period allocation

The source and native evidence agree. The current RPC in `20260812000019_measure_period_reserve.sql:282-306` binds every submitted row to its two arguments. It never proves that the period belongs to the supplied fund. `20260812000011_local_measure_fund.sql:465-471` has separate period/workspace and fund/workspace foreign keys, so a same-workspace mismatch satisfies both. The RPC deletes rows for the supplied pair, then inserts the mismatch. The preserved control uses another category ID, avoiding the period/category uniqueness constraint.

`finance-native.cjs` uses a normal signed-in owner for the RPC, with service role only for isolated synthetic setup. It refuses every stack URL except the review stack. `finance-native.json` reports accepted same-workspace mismatch and two rows under the period, with a valid control, harmless note change, rejected negative amount and rejected foreign-workspace period. This establishes an authenticated data-integrity failure in the parent's native reproduction. It does not establish cross-tenant access, lower-role authorization, an unauthorized outsider or application-route bypass without direct authenticated RPC access.

Correction belongs in database relationships, not only the RPC or UI. Add an additive unique period identity including period, fund and workspace, then enforce that same composite identity in allocations, off-the-top rows and reserves. Audit existing mismatches before validating new constraints; do not silently discard them. The RPC should reject mismatched arguments before deletion, and direct table access must also fail. Relevant native regressions are same-workspace wrong fund, wrong workspace, direct insert/update, all three child tables, valid control and preservation of earlier rows on refusal. Existing allocation-rule and recipient ownership should receive separate checks rather than assuming the period fix covers them.

I agree this is a consequential financial integrity defect. Parent implementation guidance should distinguish an actual rejected negative allocation from silent stored negative money, since the parent's negative test confirms rollback preserves the prior allocation.
