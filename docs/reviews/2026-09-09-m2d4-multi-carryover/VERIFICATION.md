# M2d.4 multiple carryover allocations

Engineering increment, unreleased. Verification is in progress; no final acceptance or CI claim yet.

Extends Saved reconciliation with multiple source-fund and adopted successor work/fund allocations per old work element. Several old elements can share a successor. The read-only legacy projection preserves original approval JSON, hashes and exact pending retry payloads. New arrays require null legacy scalar mapping fields. Source and successor fund ceilings aggregate the rows and retained approved reservations, including legacy mappings and successor amendments. Reopening keeps the previous approval reserved until replacement approval. No expense is copied.

Owned checkout: `/home/nathaniel/.local/state/openplan/m2d4-multi-carryover-2026-09-09`, based on `609347ad`. Named disposable stack: `supabase_db_m2d3-reimbursement-verification`, API 58821, database 58822. Migration 311 is additive and changes functions only. Upgrade preservation runs transactionally on `supabase_db_m11-contract-verification-upgrade`; neither stack is reset.

The first extended cross-cycle test had a SQL operator-precedence error in fixture construction. The harmless mutation control failed, so none of that run counted as mutation evidence. Parenthesizing the JSON expression corrected the fixture. Initial evidence is retained separately.

Limits: amounts are reviewed carryover authority, not available cash. Funding vintage, legal conditions and real authority depend on the retained human evidence. Independent two-cycle reconstruction, exact restore and practicing-finance usefulness remain open. These checks do not prove bank transfers, agency-prescribed forms, automatic reminders or full OWP administration.
