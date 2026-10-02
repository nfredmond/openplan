# Financial integrity and complete-read corrections

## Corrections

FIN-01 preserves integer-cent half-up allocation and deterministic ID ordering. When an over-allocation exceeds the final recipient's amount, the adjustment continues through preceding recipients without creating a negative share. Every adjusted recipient carries the residual flag. Ordinary allocations remain unchanged. Focused cases include two cents split four ways and a zero-weight final recipient.

FIN-02 adds a unique period/fund/workspace parent and composite foreign keys for allocations, off-the-top deductions and reserves. The replacement function locks the actual accessible period before deletion, including empty replacements. It refuses a different fund or unavailable parent. New writes cannot bypass the relationship through direct authenticated table access.

The additive migration does not silently repair or delete historic mismatches. It validates clean tables immediately. If mismatches already exist, it preserves them, leaves the corresponding constraint NOT VALID and emits a reconciliation warning. The constraint still applies to new and changed keys. A native rollback-only upgrade test verifies record identity and retained values for each of the three tables, along with operator reconciliation and later validation.

FIN-03 reads until an empty page and advances by the number of returned rows. The shared complete-read helper enforces a page ceiling and refuses incomplete reporting. Adjacent preparation/source/extraction loops receive equivalent short-page behavior and a ceiling. Stable ordering and the captured history cutoff are retained.

UI-01 scopes submittals through `projects!inner(workspace_id)` and `projects.workspace_id`, reflecting the actual schema. Projection/filter assertions now catch restoration of the invalid column, and a native query checks real authorized and foreign-workspace records.

Generated project exports now paginate 15 previously unpaged query paths. Existing chronological ordering gains a unique tie-breaker; dataset links use their project-scoped unique dataset ID. Read failure or exhausted page ceiling refuses the artifact. No partial prefix is represented as a complete export. The new builder test inspects actual JSON bytes under a three-row simulated cap and fails on a later-page outage.

## Verification boundaries

The initial financial/reporting/dashboard suites pass 56 tests. Preparation, generated exports and order guards pass 8. Native financial/dashboard and existing measure RLS checks pass 10; the independent parent-migration suite passes another 10. Full integration evidence is recorded separately in STATUS.md.

`evidence/root-mutations.py` exercises five guards. Every harmless comment survives. Removing the nonnegative clamp, truncating reporting, stopping preparation on a short page, restoring the invalid dashboard filter and truncating exported records each fail their named assertion. Source restores exact saved bytes in `finally`. Native migration tests additionally remove each FK and parent guard within rollback transactions, and detect attempted deletion of historic records. Unit mocks cannot establish native authorization; native tests cannot establish a full agency accounting workflow.

The export tests use real builders with synthetic transport. They do not establish a transactionally consistent snapshot across concurrent HTTP requests or unbounded export size. Requests with extremely large related-ID lists may refuse rather than complete. The page ceiling is explicit refusal. No published scientific metrics or geographic evidence are changed by these read corrections.

## Existing-record reconciliation

For an installation receiving the migration warning, retain a backup and inspect the affected table against `measure_fund_periods` using period ID, fund ID and workspace ID. Determine the intended financial record from its source and history. Correct it through a recorded administrative reconciliation; do not bulk-reassign it to whichever parent makes a constraint pass. The upgrade itself preserves every record.

After reconciliation, validate the relevant constraint:

```sql
ALTER TABLE public.measure_allocations VALIDATE CONSTRAINT measure_allocations_period_fund_fk;
ALTER TABLE public.measure_period_off_the_top VALIDATE CONSTRAINT measure_period_off_the_top_period_fund_fk;
ALTER TABLE public.measure_period_reserve VALIDATE CONSTRAINT measure_period_reserve_period_fund_fk;
```

This review does not inspect or alter existing agency data. A clean installation validates all three during migration. Historical anomalies remain visible operator work, not claimed automatic repair.

The full-suite reimbursement HTTP mock now honors page ranges and checks both the data read and final empty read. The added `evidence/reimbursement-projection-mutations.py` control survives; removing the snapshot-hash projection fails the named scoped-history assertion. This tests query shape, not database enforcement.
