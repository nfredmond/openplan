# Native synthesis response link candidate

September 27, 2026. Continues the private context reader and authenticated loader at `959448f7`. This SQL remains a rollback-only candidate outside the migration directory. It is not installed, exposed through an application route or released.

## Implemented custody

The candidate stores immutable link, refresh and withdrawal events for a campaign, review, response and selected group. Each event retains exact intent, context text, hashes, predecessor and actor. A normalized dependency table retains every selected comment/reply or survey-answer identity without the legacy response writer's 300-comment limit. Dependencies do not reference deletable live source rows. They survive later source removal with the original context.

The service writer checks current staff membership before recovering an old request. It returns only an exact prior intent and exact context bytes. New writes take nonblocking request, review and response-campaign locks. The review lock matches review corrections and approvals; the response lock matches response writes and source withdrawal. A busy lock returns PT503 for retry of the same intent.

Under those locks, the native context helper reads the exact retained source, current reviewed version, current approval and current response history. It compares the complete supplied JSON context with these database records. Retained text fields remain byte-exact even when outer JSON formatting differs. The expected context digest binds the supplied text. Refresh requires a changed context, including refusal of formatting-only changes. Withdrawal retains the preceding context and remains possible after review withdrawal or response deletion. Complete private history and exact-request readers check current staff access.

## Native evidence

The test loads candidate DDL and synthetic fixtures in one transaction, calls production source/review/approval/response functions through the application loaders, and rolls everything back. The selected group contains 303 source identities, including survey answers. Its normalized membership matches the complete selected set. It verifies original text, correction, exact retry after later removal, reasoned refresh/withdrawal and private history. It also checks anonymous, viewer and foreign-workspace access, direct table/helper permissions and event/dependency immutability.

The initial baseline and harmless-comment cases pass. The first expanded run passes 37 of 39 cases. Both failing fault-control cases remove the actor filter; an earlier viewer assertion detects the resulting permission leak before the expected foreign-workspace assertion. The test now checks foreign access before role revocation, giving each fault its own assertion. No SQL guard or required denial was weakened. The corrected expanded run passes all 39 cases: seven baseline/lock controls and 32 deliberate fault cases. The fault cases include 29 named validation/access/history failures and three deliberately removed locks that admit otherwise blocked writes.

Separate PostgreSQL sessions hold the request, review and response advisory locks. Fixture setup temporarily uses distinct advisory keys, then restores every original function definition before probing the production key. The unrelated-lock and harmless-comment controls permit writes. A held relevant lock refuses the new write; releasing it permits the same request. Deliberately removing each lock permits the otherwise blocked write. These are actual lock-barrier tests, not proof of every two-writer commit order.

The final test source passes standalone lint and a 6144 MB TypeScript check. [Candidate evidence](native-candidate-checks.json) records source and private log hashes. After the run, both candidate tables are absent from the database and its installed migration count remains 347. These checks do not repeat full application QA or establish installation/public behavior; the application code has not changed since the loader checkpoint. The candidate is not included in the ordinary live-suite command yet. Run the focused test from `openplan/` with the named isolated stack:

```bash
OPENPLAN_SUPABASE_WORKDIR=/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050 \
OPENPLAN_RLS_LIVE_TEST=1 node --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run \
  src/test/engagement-synthesis-response-candidate-rls.test.ts
```

## Required before activation

- Complete mutation coverage for remaining native validation and relational constraints. Retain the current positive controls and targeted fault cases.
- Join live comment/reply changes, survey-answer redaction/session review, review correction, approval withdrawal and response edits to public withdrawal. Test both commit orders and actual concurrent writes. The current candidate links retained historical input; it does not prove current source publication eligibility.
- Trace and join every public response, portal, report and export reader. Empty legacy comment IDs must not bypass survey-derived dependencies. Private context and review reasons must never enter public payloads.
- Implement application event/history verification, exact-request recovery, route authorization and durable client intent. Extend decision provenance without changing old context bytes.
- Promote the candidate to an additive migration only with complete native/public boundary evidence. Run isolated installed-schema, populated upgrade and relevant regression checks, then identified desktop/390px browser journeys and artifact checks before a release claim.

Reviewed synthesis exports and optional complete resumable generation remain M9b work. This candidate does not complete M9b, human usefulness evidence, nationwide model validation or the V1 contract.
