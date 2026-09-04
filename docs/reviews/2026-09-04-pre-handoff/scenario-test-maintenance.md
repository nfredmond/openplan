# Scenario test-environment maintenance

September 4, 2026. Uncommitted change in the isolated
`/home/nathaniel/.local/state/openplan/technical-review-2026-09-04/audit-checkout`
only. The active `/home/nathaniel/code/openplan` checkout was not edited.

## Cause and smallest repair

The parent reported CI at `6f353b0e33921815766` failing to collect two scenario
suites after the page imported `guided-comparison-evidence-server`. That module
correctly imports `server-only`. The installed marker package exports an empty
module under the `react-server` condition and throws under its default condition;
Vitest's configured jsdom environment takes the latter. This is a test import
boundary failure before behavioral assertions can run, not evidence that the
production server component itself fails in the browser.

Added the following immediately after imports in each of:

- `openplan/src/test/scenario-detail-page.test.tsx`
- `openplan/src/test/scenario-panels-do-not-restate-a-failed-read.test.tsx`

```ts
// These tests render server components in jsdom; keep their server loaders real.
vi.mock("server-only", () => ({}));
```

That is the whole final diff: three added lines per file, including the blank
line. Neighboring RSC suites already use this file-local marker mock. No production
import, package export, global test resolver, page/panel implementation, fixture,
existing subject mock or assertion was changed. The guided evidence loader stays
unmocked. This repair does not claim the existing suites cover every new guided
comparison loader branch; their claim remains the behaviors they assert.

## Verification and failure proof

Command, from the isolated clone's nested app directory:

```bash
npm test -- src/test/scenario-detail-page.test.tsx src/test/scenario-panels-do-not-restate-a-failed-read.test.tsx
```

The repaired baseline ran both suites and passed all 22 existing tests. Mutation
proof then ran in this order, using only temporary edits in the isolated clone:

| Probe | Result and decisive assertion |
|---|---|
| Append harmless comments to real page and panel | 22 passed; no-op survived. |
| Hide the page's `metric.incomparableReason` paragraph | 1 failed, 21 passed; `prints why a metric could not be subtracted, beside the two values` could no longer find the measurement-method explanation. |
| Bypass the registry's unreadable-entries branch for the baseline | 1 failed, 21 passed; the real-panel failed-read test found the forbidden instruction to register a missing baseline. |
| Pass `entries: false` in the page-to-registry unreadable-state prop | 1 failed, 21 passed; the same real-panel test caught the lost disclosure across the page/panel seam. |
| Restore exact original page and panel bytes | Both suites and all 22 tests passed. |

The mutation driver restores both sources in `finally` by writing their captured
original bytes, never by Git checkout/reset. Byte comparison returned true and
Git showed no final diff in either production source. Original SHA-256 values:

- Scenario detail page: `4e2b9bb8dcd246409258797738fe065add1e84f8a2e69ce30938985d2c7613dd`
- Scenario entry registry: `2626838db046852842dce282554aa9ce41e33053f05533d24124f5674e628a4f`

Focused ESLint on the two modified tests passed with zero warnings; scoped
`git diff --check` passed. No application/browser/database calls or service
changes occurred. These are jsdom render checks with existing database mocks;
they do not establish live reachability, rendered pixels, deployment auth/RLS,
scientific validity or user acceptance.

Evidence remains beside this report:

- `independent-engineering-scenario-repaired-baseline.log`
- `independent-engineering-scenario-noop.log`
- `independent-engineering-scenario-missing-comparison-explanation.log`
- `independent-engineering-scenario-failed-read-as-missing-baseline.log`
- `independent-engineering-scenario-lost-page-panel-disclosure.log`
- `independent-engineering-scenario-restored.log`
- `independent-engineering-scenario-mutation-results.json`
- `independent-engineering-scenario-mutations.py`

The clone contains other agents' consolidation and guard changes, left untouched.
The active checkout's final read-only `git status --short` was empty. Nothing was
committed by this lane.
