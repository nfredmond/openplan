# Preparation outcome recovery after expiry

GitHub review of PR #115 identifies a saved-outcome recovery defect in the
preparation queue. The journal syncs the exact outcome before sending completion.
If the worker stops until its lease expires, the database rejects completion even
when its token remains current. The coordinator retains that journal and excludes
the same request from fresh local attempts. Restart alone cannot clear the case.

The revised native fixture reproduces this refusal on the prior function. Both
positive controls fail with `Preparation lease is not active`. Additive migration
`20261015000014_engagement_synthesis_preparation_recovery.sql` lets the current,
unsuperseded attempt finish its retained outcome after expiry. It preserves the
locked token check, current staff scope, cancellation, valid failure codes, exact
request seal and exact terminal replay. Expiry still prevents renewed execution
and permits another worker to claim. A newer claim fences out the old token.

The isolated native suite passes all 35 cases after the correction. The harmless
comment survives; restoring expiry refusal separately for saved failures and
sealed results fails the intended case. Existing token, cancellation, scope,
seal and terminal replay faults remain detected. Worker, journal, coordinator and
release-ordering suites pass 111 tests in four files. The original migration is
unchanged. [The evidence record](preparation-recovery.json) retains log hashes,
stack identity and limits.

The local Supabase security advisor exits 1 for the existing PostGIS extension
table `public.spatial_ref_sys`, which has no RLS. This change does not alter that
table, its grants or the exposed schemas. The advisor is not reported as clean.
Relevant [database function guidance](https://supabase.com/docs/guides/database/functions)
and the Supabase changelog were consulted; this is a PostgreSQL function correction,
not a Supabase runtime upgrade.

Earlier QA, browser and upgrade results retain their original commits. The new
migration requires fresh final-head GitHub QA, live isolation, restoration and
populated upgrade results. Their disposition is recorded in PR #115. This probe
does not prove a real provider call, a process-kill journey or a simultaneous
claim race, and it does not close complete staff generation or v1 acceptance.
