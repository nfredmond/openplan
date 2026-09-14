# Receipt privacy and full-suite findings

September 13, 2026. Continues the activation reset checkpoint in the same isolated checkout and branch. The prior turn made progress by saving activation at 460431b5. This increment adds real direct receipt reads and closes the missing JOIN-scoped receipt registration with evidence, without adding a coverage excuse.

## Receipt evidence

The activation SQL fixture now verifies the exact retained receipt is readable by its staff actor, while a workspace viewer and an outsider see no campaign receipts. Anonymous direct SELECT must be refused by table privilege. Owner read is a positive control, not just a set of denials. Existing command, retry, history, correction and direct-write protections remain exercised.

`prove-translation-activation.py` completed 20 cases: baseline and harmless comment survived; 18 targeted faults failed for their expected reasons. Four new cases separately hide staff receipts, expose viewer receipts, expose outsider receipts and grant anonymous SELECT. All database changes were rolled back on the named preserved pre-activation clone. Source and fixture hashes in `translation-activation-controls.json` match the restored files.

`prove-translation-receipt-census.py` proved the actual installed-schema coverage check: baseline and harmless comment survived; omitting only the receipt registration failed with the JOIN-scoped receipt-table assertion. The structured report is `translation-receipt-census-controls.json`. The registry checks registration, not access semantics; the separate real SQL fixture and policy faults prove those semantics. Neither proves browser navigation or worker operation.

Focused ESLint and diff checks passed. Product direction check passed with existing age/version reminders, not a fresh whole-product reassessment.

## Full checks

Full isolated RLS completed with exit 0: **54 files and 484 tests passed**. This includes the new direct receipt privacy fixture and JOIN census registration. The fault controls above establish that the changed checks can fail. Log: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-receipt-full-rls.log`.

The full unit run finished: 1282 passing files, 8 failing files, 47 skipped; 14843 passing tests, 9 failures, 462 skipped. These are branch-wide failures discovered by the broader run, not a passing release gate. Log: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-receipt-unit-suite.log`.

Two failures were then corrected: CHANGELOG Unreleased now names migration 17 and accurately describes activation and the retired HTTP route; `.env.example` now documents the worker journal directory already used by its implementation and runbook. Both unchanged mechanical guard suites passed, 12 tests. The first attempted focused command ran from the wrong package directory and failed to find the test runner; the reported pass is the corrected app-directory invocation in `translation-doc-gates.log`.

## Next fixes before claiming full QA

- `a-column-nothing-reads-is-a-question.test.ts`: inspect eight generation columns whose actual SQL/worker readers are outside this scanner's current view. Account for real custody readers rather than adding artificial reads. Remove the obsolete response payload checksum exception if its real reader warrants that.
- `a-policy-without-a-grant-is-a-locked-door.test.ts`: migration 17 revokes direct staff DML while three older permissive writer policies remain. Resolve that schema/policy mismatch without restoring direct writes or weakening the command-only boundary.
- `every-api-route-audits.test.ts`: the retired translation route no longer audits. Decide the proper refusal audit and verify it does not read private bodies or trigger effects.
- `every-api-route-has-a-caller.test.ts`: register the deliberately retained 410 route as an old-client endpoint with executable tombstone evidence. Do not fabricate an in-app caller.
- `planner-copy-says-the-plain-thing.test.ts`: new rendered strings add one campaign and one record occurrence. Improve the actual copy; do not raise the baseline.
- `migrations/inventory.test.ts`: inspect the three new generation tables and update the measured inventory with controls. It currently expects 258 relations and finds 261.

Then adapt the old browser wrappers to installed 336/17 privileges. They must preserve command execution, not revoke it at exit. Finish the actual desktop/390px generation-worker-publication journey and editor recovery gaps, public comment durability/privacy, remaining QA/shuffle/worker/upgrade checks, and exact final main CI before release. All earlier full-V1 scope and free/local constraints remain. No release or main merge is claimed here.

Terminal RLS summary:

```text
Test Files  54 passed (54)
      Tests  484 passed (484)
   Start at  18:50:43
   Duration  410.70s (transform 928ms, setup 2.04s, import 2.84s, tests 379.92s, environment 20.16s)
```
