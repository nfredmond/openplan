# Retained review server checkpoint

September 14, 2026. This is incomplete M9b implementation after the reset checkpoint 2f23e0eb. It does not complete the connected workflow in IMPLEMENTATION_BOUNDARY.md. No new release, main landing, model generation or human acceptance is claimed.

## Implemented

The private review API now accepts bound create/correction commands, computes complete original preparation and corrected content on the server, checks the service writer's receipt, and supports staff-only reads and both metadata histories. It rejects unsupported assistant write markers, foreign browser origins, oversized commands, stale actor/workspace identities, malformed or repeated query parameters, foreign history and failed reads. A failed read is not an empty source or a successful save.

The saved-review reader verifies exact preparation/content hashes, source identity and checksum, original author/intent, correction reason and parent ID/hash, descending revision numbers and stable root context. It walks the requested revision's complete lineage, reconstructs algorithm-1 preparation from the verified immutable source, and replays every retained staff command. A checksum that matches altered bytes is insufficient. Old revisions remain inspectable without rewriting their content, preparation or sources.

Exact request recovery precedes computation and stale-parent checks. A new regression demonstrated a false conflict when another tab committed the same correction between request lookup and head lookup. The corrected server rechecks that exact command before reporting a parent or transactional conflict. A changed command still conflicts. The regression's pre-fix failure is retained in private evidence.

No interface currently calls this API. The existing saved source inspector is the intended entry point. The legacy capped generator remains separate.

## Evidence

- Nineteen focused server/API tests passed using real verification, preparation and correction code, with mocked session/access reads and RPC transport. No production computation is stubbed in these tests.
- The server/API mutation runner completed 36 cases: baseline, one harmless comment control and 34 targeted faults. Every case had its expected outcome and the three changed production files were restored byte-for-byte. See review-server-mutations.json and prove-review-server.py.
- Three native TypeScript/RPC join cases passed on supabase_db_openplan-restore-target-2026091050. One open transaction runs the actual source fixture, optionally installs candidate migration 27, lets production TypeScript call actual authenticated/service-role RPCs, then rolls everything back. The original and correction retain all 303 selected contributions, complete Unicode/apostrophe notes, exact requests and immutable original bytes. The harmless SQL comment survives. A targeted database-function fault replaces the staff note; the real server rejects its receipt and subsequently rejects the altered revision on read.
- The existing source native suite passed all 16 cases after its earlier scoped-count fixture correction.
- Candidate catalog verification returned 269 application relations, 255 tables and 255 RLS-enabled tables in a rolled-back transaction. The first unfiltered count returned 272/256/255 because it included PostGIS spatial_ref_sys, geometry_columns and geography_columns. Excluding extension-owned relations through pg_depend.deptype='e' yields the application census. Do not change the application inventory to count extension objects.
- Changed-file ESLint passed. Final TypeScript checking is recorded in review-server-evidence.json; consult its result rather than treating the earlier failed invocation as success.
- The unmodified every-api-route-has-a-caller check currently fails exactly for api/engagement/campaigns/[campaignId]/synthesis/reviews. Its other nine tests pass. This is an expected incomplete-work boundary, not an exemption or an infrastructure failure. Complete the real UI caller and browser workflow before full QA or main landing.

The earlier 31 native custody cases remain applicable to unchanged migration 27. They prove role/grant restrictions, immutable rows, exact-request retention, correction lineage and pagination, including timestamp ties. They are not a fresh multi-session concurrency experiment. The new interleaving regression mocks the transport; actual concurrent HTTP/database tests remain necessary.

## Runner errors and limits

The first standalone type check exhausted Node's default 4 GB heap before producing a verdict. A rerun using the repository build's 6 GB heap allowance completed checking and found a TypeScript union-field access error in the new native test fixture. The fixture now compares against its explicitly declared complete notes string. A final check follows that correction. No compiler failure was counted as green.

The mutation runner stopped on an ambiguous replacement for a repeated database error guard, and then on a misspelled access-error replacement. Both attempts restored production files in finally blocks. The completed run uses explicit, checked seams. A script-edit attempt from the package directory also missed the repository-relative documentation path; the edit was rerun from the repository root. None of these runner mistakes modified the database or another checkout.

This checkpoint does not prove browser recovery, keyboard/390px usability, multi-session concurrency, performance over thousands of revisions, planner usefulness, approval evidence, optional model batching, response/decision linkage or reviewed exports. Whole-product V1 and M9b remain open. Loading a revision currently verifies its full ancestor chain; do not silently cap that history to improve timing. Measure long histories before making performance claims.

## Next integration

Use engagement-synthesis-sources.tsx after its verified source inspection. Preserve a source/account/workspace/campaign-scoped exact pending command before sending. Keep a confirmed save confirmed if cleanup or reopening fails. Clear private review state on account changes and stale requests. Implement create, saved review history, revision inspection, reasoned notes/group/membership edits and opening the latest version before editing an old revision. Membership controls should show actual retained contributions, not require planners to type database identifiers.

Keep original preparation separate from staff interpretation. Show assigned, unassigned and overlapping contributions without turning them into distinct-person counts or representative support. Retain unassessed states. Add meaningful storage/UI mutation evidence, native concurrency and desktop/390px real navigation before claiming the workflow works.

Migration 27 is still candidate-only. The named stack remains at 345 installed migrations through 26. Apply it additively after candidate verification and before the full identified-build browser run. Never reset/drop. Complete full QA, shuffled tests, installed isolation and relevant upgrade checks, push the coherent increment directly to main, and inspect final CI before tagging. No draft PR or human software-release review is needed.
