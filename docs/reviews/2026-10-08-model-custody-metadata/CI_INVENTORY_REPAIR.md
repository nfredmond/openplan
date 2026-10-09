# Reconcile migration and reader inventories

Date: October 9, 2026. This repairs CI integration failures, not access policy.

Completed GitHub runs [37920070563](https://github.com/nfredmond/openplan/actions/runs/37920070563)
and [37918768104](https://github.com/nfredmond/openplan/actions/runs/37918768104)
identify four stale inventories after instrument member-read support:

- Migration 24 was absent from the Unreleased migration instructions.
- The exact policy census omitted its SELECT policy and newly policy-bearing table.
- The dedicated RLS probe list included instrument custody, but the assertion's
  expected inventory did not.
- Two SQL-only `artifact_id` exceptions collided with the identifier now present
  in the instrument reader's TypeScript projection type.

The repair names `20261016000024_model_attempt_instrument_member_read.sql` and
its operator effect in the changelog. The policy census now expects 759 policies,
508 permissive policies and 227 tables with policies. A read-only query against
the retained native `instrument-rls-census-20261009a` candidate confirms those
three totals and the authenticated SELECT policy on instrument custody. No write
policy, table grant or migration was changed by this repair.

The RLS inventory now names its already-existing dedicated live probe. The two
artifact-ID exceptions move to the existing name-collision list. Their native
SQL explanations remain intact; a global identifier match does not prove that
the application reads those private tables.

All four scoped Vitest files pass from the application package: 42 checks pass
and 21 live-only checks are skipped. Six controls pass expected outcomes: a
harmless comment, each of the four original defects reintroduced separately,
and restored source. The runner restores all source bytes in `finally`; see
`prototype/integration-inventory-controls.json`. Private logs are retained under
`integration-inventory-controls-20261009a` in local OpenPlan state. An initial
invocation from the repository root failed to locate the package's migration
folder; it is not counted as verification.

These static checks do not replace the native fixture, full GitHub RLS/restore
jobs or the full QA gate. Fresh-head CI must still complete before integration.
