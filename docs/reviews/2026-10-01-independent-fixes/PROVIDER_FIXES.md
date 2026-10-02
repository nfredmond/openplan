# Financial action consent and native-result recovery fixes

October 1, 2026. Baseline: `891a0d89a848133d44b9e4f314a76a922cd71ace`. Working branch: `fix/independent-review-20261001`. This report covers corrections to PROV-01 and PROV-02 from the independent review. It does not declare a release or whole-product acceptance.

Ownership is limited to the four financial routes, action-registry funding-profile effect, native provider route, connector recovery, their tests and this report's `providers-*` evidence. Other agents own the remaining fixes and Git publication. No live database, demo, native provider account, real provider dispatch or browser resource was used. The direction check passed with its existing review-age reminders. Requirements and action approval schemas remain unchanged.

## PROV-01: exact approved payloads and stale creates

The routes now call the existing raw-body agent-scope guard before consuming an approval. Their agent allowlists match the fields emitted by each registered action:

| Route | Permitted agent fields | Enforcement location |
|---|---|---|
| Project funding profile | Optional notes | `openplan/src/app/api/projects/[projectId]/funding-profile/route.ts:45` |
| Create funding opportunity | Project/program IDs and title | `openplan/src/app/api/funding-opportunities/route.ts:328` |
| Funding opportunity decision | Decision state | `openplan/src/app/api/funding-opportunities/[opportunityId]/route.ts:91` |
| Invoice funding-award link | Workspace ID and funding-award ID | `openplan/src/app/api/invoicing/invoices/[invoiceId]/route.ts:80` |

Unsigned amounts, invoice status, opportunity metadata and unknown future fields produce a refusal before approval consumption or business writes. Invoice unlink requests cannot skip verification through the nullable manual field (`invoices/[invoiceId]/route.ts:96`). Manual editing retains its existing broader fields and authorization.

Profile creation now uses `insert` for agent requests, while manual editing retains `upsert` (`funding-profile/route.ts:134-156`). The existing unique `project_id` constraint in migration `20260410000043_funding_awards_and_profiles.sql:4` makes concurrent or stale creation fail without overwriting a profile. A unique conflict returns HTTP 409 and a failed execution audit. As before, approval consumption and business write are separate operations; this change does not claim to resolve the known atomic-consent limitation.

The registry now sends only the action's optional notes (`action-registry.ts:100-112`). Its former fallback note was not part of the signed action when notes were omitted; its null financial keys were also outside the action. Removing those injected values preserves the existing action schema/hash and lets an approved no-notes create reach the route faithfully. New profiles still have null amounts and null notes when the action omits notes. An older browser sending the previous wider body receives a refusal and must reload before executing this action.

The new `financial-agent-payload-binding.test.ts` executes all four real registry effects through the real routes, real approval verifier and real execution audit helper. It also covers manual edits, each unapproved field, unknown keys, signed-note mismatch, nullable invoice unlink and simulated unique conflict. The mocked database checks exact approval projection and records writes and audit outcomes. It does not replace native RLS, unique-index concurrency or transaction testing.

## PROV-02: retained invalid results can reach a terminal outcome

The native route treats invalid JSON or task-schema output from an otherwise identified provider attempt as a terminal `native_invalid_output` failure. It sends null result and receipt to the existing locked finish RPC (`api/assistant/providers/native/route.ts:56-73`). The RPC still enforces connection access, ownership, exact attempt, cancellation and idempotent retained outcome. Unexpected implementation errors do not become model-output failures.

The connector also handles a definitive HTTP 400 rejection of a retained envelope (`workers/planner_agent_connector/connector-worker.mjs:130-151`). It reads current authorized status and requires the same turn and attempt. If the attempt is terminal, it records that acknowledgement. If it is still running and the retained delivery was a result, it preserves the original bytes as `rejectedDelivery`, syncs a failure-only delivery with `native_result_rejected`, then sends that failure for the same attempt. A response loss replays the retained failure. A second failure rejection does not recursively replace failures.

Network loss, HTTP 403, rate limiting and server errors leave the original completed delivery intact. Configuration mismatch, different attempt and different turn remain refusals. No recovery path calls the provider again. A subsequent normal queue claim is possible only after the journal has a confirmed terminal acknowledgement; that is not authorization to regenerate the old turn.

`provider-native-recovery-composition.test.ts` combines the real connector and native route with synthetic generation and a checked RPC model. It covers valid output, invalid JSON/whitespace, lost acknowledgement, cancelled retained output, invalid receipt-envelope recovery, durable failure before delivery and exact failure replay. The existing provider-route tests now assert that malformed output is stored only as failure, while changed attempts/receipts remain refused. Connector tests cover different identities, unknown outcomes and configuration changes.

## Verification

| Check | Result | Blind categories |
|---|---|---|
| Four focused application suites: new financial binding, new native composition, provider routes, profile route | 134 tests passed | Real database authorization, concurrent SQL behavior, network transport, actual provider billing, native sandbox |
| Five related suites: opportunity create/detail, invoice detail, action registry, registry completeness | 86 tests passed | Same mocked-database limits; browser behavior and practitioner usefulness |
| Connector worker suite | 27 tests passed, no skips | Real provider execution, physical power loss, true process crash and native account state |
| Scoped ESLint on changed TypeScript source/tests | Exit 0 | Runtime correctness, database behavior |
| Diff whitespace check on owned changes | Exit 0 | Semantic correctness |
| Mutation harness | Harmless comment control survived; 15 targeted mutations detected | Covers listed assertions, not every possible fault |

Evidence is retained alongside this report in `providers-vitest.txt`, `providers-related-tests.txt`, `providers-node-tests.txt`, `providers-eslint.txt`, `providers-mutations.json` and individual `providers-mutation-*.txt` files.

The mutation harness restores exact pre-mutation bytes in `finally` and never uses destructive Git resets. It accepts the harmless control only when both application and worker checks exit zero. A targeted result counts only when a nonzero run contains the expected named failure and assertion/error evidence. The tested defects are removal of each route scope guard, insert changed to upsert, unsigned registry fallback, invoice unlink bypass, manual requests incorrectly refused, invalid output losing terminal failure, missing 400 recovery, attempt mismatch bypass, failure sent before journal sync, terminal acknowledgement disabled, connection mismatch bypass and unknown outcomes converted into failures. All mutated source is restored.

Initial test-authoring corrections were an incorrect expected actor label (`agent` versus the actual `planner_agent`), POST status expectation (201 versus 200), and running existing tests from the wrong working directory. Those were corrected before verification results were counted. A TypeScript RequestInit mismatch in the new registry bridge was corrected to use the NextRequest constructor type. No production failure was hidden by changing a required behavior assertion.

Reproduction from the application package:

```sh
./node_modules/.bin/vitest run src/test/financial-agent-payload-binding.test.ts src/test/provider-native-recovery-composition.test.ts src/test/provider-routes.test.ts src/test/project-funding-profile-route.test.ts
./node_modules/.bin/vitest run src/test/funding-opportunities-route.test.ts src/test/funding-opportunity-detail-route.test.ts src/test/billing-invoice-detail-route.test.ts src/test/action-registry.test.ts src/test/action-registry-is-complete.test.ts
```

From the repository root:

```sh
node --test workers/planner_agent_connector/test/connector-worker.test.mjs
python3 -B docs/reviews/2026-10-01-independent-fixes/providers-mutations.py
```

Do not run the mutation harness while another session is verifying these files. Full repository QA, native database checks, independent source cross-review, commit, push and PR status belong to the coordinating agent and are not claimed by this subreport. These corrections enforce the declared agent header path under an already-authorized user session; they do not establish a separate delegated database principal or prevent a session holder from using the permitted manual endpoint.

## TypeScript follow-up

The coordinator's final TypeScript check caught a test-bridge interop error: JavaScript inferred `ConnectorError`'s default-null status parameter as accepting only null. The synthetic bridge now constructs the same error class and assigns its numeric HTTP status explicitly. The runtime class, code and status remain the same; no implementation file changed. The seven real connector/route composition tests passed again after this correction (`providers-composition-type-followup.txt`). The coordinator's reported compiler rejection establishes that the compile check detects this specific defect.

The full application `tsc --noEmit --incremental false` check then completed with exit 0 and no diagnostics (`providers-typescript.txt`). This verifies the shared fix worktree as it stood during that run, including the test-only correction; it does not substitute for runtime or native database checks.
