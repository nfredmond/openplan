# Scoped validation and fault evidence

October 16, 2026. Source and synthetic DOM evidence only.

## Terminal checks

- Product direction check: exit 0 at base f8a571b, with the existing dated reminders.
- Final focused Vitest run: exit 0, seven files, 156 tests passed, no failures.
- Scoped ESLint: exit 0, all 11 changed TypeScript/TSX files, no warnings.
- Scoped TypeScript 5.9.3: exit 0. The private configuration includes budget.ts, budget-queries.ts, their loader and SQL-source tests, and the transport fixture. It follows their dependency closure, skips library checking and disables incremental output. It is not a whole-project compiler or page type check.
- Whitespace/diff and candidate hash checks are recorded with the local commit handoff.

The final test files are `project-budget-queries`, `project-budget`, `project-budget-panel`, `project-budget-snapshot-migration`, `project-detail-page`, `the-deliverable-update-control-is-reachable` and `the-record-reassignment-control-is-reachable`. The private `final-tests.json` records every assertion result and the identified assigned-checkout paths.

All commands execute serially through the shared `compiler-repair-checks-20261015.lock`. Every test run uses one Vitest worker and disables file parallelism. The systemd units request 1 GiB memory, zero swap and 50 percent CPU. Node heap is limited to 512 MiB. An owned Vitest cgroup observation records `memory.max=1073741824`, `memory.swap.max=0`, and `cpu.max=50000 100000`.

The final private Vitest configuration copies the canonical test options. Its changes resolve the assigned app alias without __dirname, set a private Vite cacheDir, and use the runner config loader. npm notifier/audit/fund are disabled, with private cache/log paths from the first npm call. The initial Vite cache isolation violation and all failed setup attempts remain explicitly recorded in REPORT.md.

## Harmless survivors and named faults

The all-source harmless comment mutation passes all 155 original focused cases. After the page line-limit correction and assignee-only regression, the same harmless mutation passes all 156 cases. The final missing-RPC correction also has its own harmless survivor over 23 loader cases. These results establish that the harness can report a survivor. Each targeted run below has a nonzero test exit, a parsed test report with the named failed assertion, and byte-for-byte restoration. A setup error or generic runner failure never counts as a killed fault.

- `01-read-failures`: returns a failed client-invoice read. Observed `AssertionError: expected false to be true // Object.is equality`.
- `02-source-pending`: keeps a pending migration classified. Observed `AssertionError: expected false to be true // Object.is equality`.
- `03-assignee-rung`: drops only the assignee column. Observed `AssertionError: expected false to be true // Object.is equality`.
- `04-budget-rung`: falls all the way back. Observed `AssertionError: expected false to be true // Object.is equality`.
- `05-deliverable-cap`: retains inputs above every old cap. Observed `AssertionError: expected [ { id: 'd0', …(9) }, …(199) ] to have a length of 1201 but got 200`.
- `06-spend-cap`: retains inputs above every old cap. Observed `AssertionError: expected [ { id: 's0', …(6) }, …(499) ] to have a length of 1201 but got 500`.
- `07-invoice-cap`: retains inputs above every old cap. Observed `AssertionError: expected [ { id: 'l0', …(4) }, …(1400) ] to have a length of 2402 but got 1401`.
- `08-nested-line-cap`: retains inputs above every old cap. Observed `AssertionError: expected [ { id: 'l0', …(4) }, …(2199) ] to have a length of 2402 but got 2200`.
- `09-source-identities`: equal-valued distinct cost. Observed `AssertionError: expected [ undefined, undefined ] to deeply equal [ 'l1', 'l2' ]`.
- `10-duplicate-identities`: refuses repeated. Observed `AssertionError: expected false to be true // Object.is equality`.
- `11-envelope-validation`: refuses absent, malformed, wrong-project. Observed `AssertionError: expected false to be true // Object.is equality`.
- `12-projection-omission`: refuses omitted financial projection. Observed `AssertionError: expected false to be true // Object.is equality`.
- `13-transport-rejection`: returns thrown transport failures. Observed `Error: connection closed`.
- `14-missing-rpc`: marks a missing snapshot RPC. Observed `AssertionError: expected false to be true // Object.is equality`.
- `15-permission-is-not-pending`: keeps whole-snapshot permission failures. Observed `AssertionError: expected true to be false // Object.is equality`.
- `16-cost-and-billing`: equal-valued distinct cost. Observed `AssertionError: expected 4 to be 2 // Object.is equality`.
- `17-panel-unavailable`: withholds financial numbers. Observed `TestingLibraryElementError: Unable to find an accessible element with the role "status"`.
- `18-snapshot-notice`: identifies the snapshot migration. Observed `TestingLibraryElementError: Unable to find an element with the text: /Apply the project budget complete-inputs migration/. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.`.
- `19-page-panel-binding`: names a failed client-invoice read. Observed `AssertionError: expected [ <p …(1)></p>, <p …(1)></p>, …(1) ] to have a length of +0 but got 3`.
- `20-page-pace-binding`: withholds delivery pace. Observed `Error: expect(element).not.toBeInTheDocument()`.
- `21-control-transport`: requests the project-scoped complete snapshot. Observed `AssertionError: expected [ { table: 'wrong_budget_rpc', …(1) } ] to deeply equal [ { …(2) } ]`.
- `22-sql-snapshot`: one stable snapshot. Observed `AssertionError: expected 'BEGIN;\n\n\n\n\nCREATE FUNCTION publi…' to match /RETURNS jsonb LANGUAGE plpgsql STABLE…/`.
- `23-sql-permissions`: retains caller RLS. Observed `AssertionError: expected 'BEGIN;\n\n\n\n\nCREATE FUNCTION publi…' not to match /SECURITY DEFINER|ALTER TABLE|CREATE …/i`.
- `24-sql-scope`: aggregates every nested invoice line. Observed `AssertionError: expected 'BEGIN;\n\n\n\n\nCREATE FUNCTION publi…' to contain 'FROM public.client_invoice_line_items…'`.
- `25-sql-projection`: projects the existing budget and assignment ladder. Observed `AssertionError: expected [ …(2) ] to deeply equal [ …(2) ]`.
- `26-sql-order`: primary-key tie-breakers. Observed `AssertionError: expected [] to have a length of 3 but got +0`.
- `27-sql-workspace-refusal`: aggregates every nested invoice line. Observed `AssertionError: expected 'BEGIN;\n\n\n\n\nCREATE FUNCTION publi…' to contain 'AND i.workspace_id <> p.workspace_id'`.
- `28-sql-backend-cap`: one stable snapshot. Observed `AssertionError: expected 'BEGIN;\n\n\n\n\nCREATE FUNCTION publi…' not to match /\b(?:LIMIT|OFFSET|SETOF|VOLATILE)\b/i`.
- `29-sql-narrow-fallback`: projects the existing budget and assignment ladder. Observed `AssertionError: expected [] to have a length of 2 but got +0`.
- `30-assignee-only`: only the assignee column is pending. Observed `Error: expect(element).not.toBeInTheDocument()`.
- `31-missing-rpc-is-not-old-columns`: marks a missing snapshot RPC. Observed `AssertionError: expected true to be false // Object.is equality`.

The exact changed source bytes, per-run logs, complete failure messages, JSON assertion results, before/restored hashes and invocation exits remain in the private `mutations*` directories. Repeated rounds remain separate. Faults that initially produced a less clear null-target count assertion were rerun after the source tests changed to explicit zero counts. The page zero assertion now checks an empty match list, so multiple leaked zero amounts produce an ordinary assertion failure.

## Retained failures and corrections

- The first consumer run exits 1 with five budget-control tests failing because adding an explicit assignee null activates unrelated roster fetches. The corrected transport fixture preserves its original pre-assignee-schema meaning and declares that column pending; reassignment has its separate suite.
- An owned consumer rerun waiting on the shared lock is canceled before dispatch, exit 143. No other session is stopped.
- Private config attempt one fails on __dirname under runner loading. Attempt two fails on the absolute plugin import and vite/internal resolution. Both startup failures remain separate from fault counts.
- Initial scoped lint exits 1 because the page has 1,204 counted lines against its 1,200-line limit. Passing the existing pending object directly removes repeated props; the panel checks only financial pending flags. Final lint passes without weakening the limit.
- The first two actual Vitest runs write the donor results cache. The incident record preserves the observed path, time, size and hash. Pre-run bytes are unknown. The donor is not claimed restored. The later private-cache runs leave that observed donor file unchanged over the measured interval.

## Blind categories

- Loader and arithmetic tests consume supplied synthetic envelopes. They cannot prove database aggregation, actual PostgREST row caps, current grants/RLS, SQL execution, snapshot isolation, query cancellation or capacity.
- SQL tests inspect executable source text and selected projection/scope/order forms. They are not a SQL parser and cannot establish semantic equivalence, execution plans, native schema fallbacks, caller isolation or concurrency.
- DOM tests exercise real components and page wiring with fake database/provider boundaries. They cannot establish identified-build desktop/390px navigation, console behavior, actual API authorization, usable exports or observed planner/finance acceptance.
- Scoped TypeScript does not cover every project file, page closure, generated database type, runtime provider or native schema. ESLint is static and cannot establish financial truth.
- Exact source restoration proves custody of these source edits, not database restoration or installation recovery.
- Source identities distinguish rows and detect repeated primary keys. They cannot infer an unrecorded shared physical cost across registers from matching amounts.

The preparation-only native protocol remains in NATIVE_PREPARATION.md. No native, browser, human finance, export completeness, full M11/A3 or v1 acceptance claim follows from this packet.
