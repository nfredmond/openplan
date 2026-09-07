# Round 5 independent review: workbook capacity and migration identity guard

Source checkout: `/home/nathaniel/.local/state/openplan/owp-preparation-2026-09-06`. All snapshots, mutations, fake commands, synthetic environment files and workbooks live in this round5 scratch directory. No source, database or existing service was modified. LibreOffice conversion used separate scratch user profiles. Root concurrently owned implementation and browser evidence.

## Result

No open finding remains in this bounded review after two fixes during the review. The result is specific to the snapshotted code and synthetic cases; it is not a whole-product acceptance claim.

### Workbook capacity: actual spreadsheet recalculation

Initial snapshot fixed staff identity, conflicting capacity and unknown-conversion checks, but the overlapping-period check still failed after LibreOffice recalculation. Actual W2 changed from cached `Unresolved` to `Within stated capacity` for the same employee with annual and June–October allocations. Source ISO date strings did not support the intended relational COUNTIFS criteria. The initial failing evidence remains in `workbook-results.json` and the XLSX input/output folders.

Root converted workbook program, funding, allocation and rate date cells to numeric Excel dates. The final exporter snapshot is `date-fix/current/openplan/src/lib/programs/work-program/export-structured.ts`, SHA-256 `5a20e4375e80d4840989e0b2ca93e4da0f256cd7e23361cce8232af4c0a75d9f`. The relevant branches are staffing Y/W formula construction near lines 101–103 and date-cell serialization near lines 125–139.

Final actual LibreOffice results (`date-fix/workbook-results.json`):

- Same staffId, different role labels: two 1,120-hour rows against 1,920-hour capacity remain `Overallocated`.
- Conflicting capacities: `Unresolved`.
- Differing overlapping periods: `Unresolved`.
- Unknown conversion in a contributing allocation: combined capacity `Unresolved`.
- Twelve person-months with explicit 160 hours per month and 1,920-hour capacity: `Within stated capacity`.
- Effective labor rate covering allocation: calculated cost 56,000.
- Labor rate starting after allocation begins: calculated cost `Unresolved`.

All seven baseline and harmless-comment cases pass. Four consequential scratch mutations fail precisely their corresponding capacity case after recalculation: grouping by role instead of staff identity, disabling conflicting-capacity detection, reversing the overlap comparison, and disabling unknown contributing hours detection. All inputs, recalculated XLSX files and probe scripts are retained under `date-fix/`. This runs the real exporter and installed XLSX library; source selection alone is stubbed to an empty list. It does not validate visual layout, Excel itself, database sources, exports retrieved through the application, or arbitrary external workbook edits.

### Local database identity guard

The core guard correctly refuses an API origin mismatch before migration, scopes status and migration to the same explicit workdir, captures status privately, and refuses missing/malformed configuration or unavailable status. Nine synthetic cases pass. A harmless comment survives; disabling identity comparison, dropping migration workdir, and exposing status each fail their targeted assertion. Evidence: `db-guard-probe.mjs`, `db-guard-results.json`.

An integration flaw was reproduced in the first snapshot: package.json loaded only `.env.local` into the sync process, while Next dev can prefer `.env.development.local`. Synthetic `.env.local`=stack A and `.env.development.local`=stack B produced different effective URLs using installed Node and @next/env. That could sync A successfully while the app ran against B. Initial evidence: `env-precedence-probe.cjs`, `env-precedence-results.json`.

Root changed the CLI to call `nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production")` immediately before sync, and removed Node's `.env.local` preload from the package command. Final source snapshots/hashes are under `followup-env-fix/`. `env-cli-probe.cjs` executes the copied final CLI with installed @next/env and a scratch-only fake Supabase executable. The same synthetic environment files now select stack B: matching status B allows the fake migration, status A refuses after the status call. No-op survives; removing the environment loader fails. Status credentials are absent from captured error output. Evidence: `env-cli-results.json`.

No real Supabase CLI, database status, migration or service control was invoked. Identity tests cannot establish live target identity, migration application correctness, or a database restore procedure.

## Custody and limitations

Initial source hashes are in `sha256.json`; follow-up hashes are retained separately. `git-status-before.txt` and `git-status-after.txt` record the shared checkout status around shell work. Root was editing concurrently, so changes between those records are not attributed to this reviewer. Every write issued by this review targeted the explicit scratch directory. One conversion command initially reran the pre-fix scratch fixture set from the parent directory; it touched only those scratch files and did not supply evidence for the date fix. The final date-fix run used its own directory and actual newly generated 42-file fixture set.
