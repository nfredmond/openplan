# Native thematic frame staging

October 2, 2026. This checkpoint extends the versioned thematic continuation
with private database custody. It remains internal work on the synthesis branch.
It does not release a visible workflow or complete M9b.

## Retained plan and recovery

Migration `20261015000008_engagement_synthesis_thematic_plans.sql` adds one private
frame table. It reuses the shared immutable plan, task-reference and seal tables.
Preparation requires a complete original-input seal and the new requester's
current staff membership. The header binds request scope, actor, intent, thematic
request, frozen recipe, original-input manifest and seal, content identity and
byte limits. The application reconstructs original histories before each resume.

Frame batches contain at most 128 entries and four MiB of encoded transport text.
Each opaque frame preserves its exact UTF-8 bytes, digest and cumulative chain.
A batch commits its raw frames and task references atomically. Gaps, changed
retries, overlaps into new work and wrong prefixes fail. Exact retained retries
remain readable after cancellation; fresh work does not. Current membership is
checked even for recovery.

Sealing adds a separate final proposal reference and its receipt in one database
transaction. That reference binds the complete evidence and input identities.
It is not another evidence frame and does not change the frame cursor or total.
The receipt separately hashes the exact native reference text. The application
checks those bytes and every reference field without assuming that PostgreSQL
and JavaScript serialize object keys in the same order.

Staging grants no execution authority. Segment and context executors still refuse
a thematic request. Native authorization, thematic execution journals, original
proposal storage, staff import and connected user journeys remain unfinished.

## Evidence

- Candidate SQL suite passes 42 cases, including a harmless comment change and
  targeted guard faults. Its independently calculated native frame chain and
  proposal receipt agree with the application verifier. The structural fixture
  preserves escaped NUL and unpaired-surrogate text as opaque original JSON.
- Application staging suite passes 38 tests. It covers every retained prefix,
  the 302-contribution synthetic source, count and encoded-packet limits,
  self-rehashed incorrect receipts and references, fresh original replay,
  unknown acknowledgements, cancellation, aborts and scoped custody reads.
- Initial application fault run records one survivor. Removing the post-write
  abort check was masked by the next call's abort check. A final-seal abort case
  now isolates and catches that fault. Additional faults that bypass native
  acknowledgement verification or receipt/reference schema versions fail their
  intended assertions. The original survivor remains in the evidence record.
- Additive migration installation is confined to the owned restore-target stack.
  Canonical checkout, demo and other agents' databases are unchanged.
- Authenticated HTTP recovery passes in 150.32 seconds including runner overhead.
  The real local CLI, PostgreSQL and PostgREST use a synthetic provider. A proxy
  drops the response after a thematic frame batch commits; a fresh invocation
  reconstructs originals, resumes the native cursor and seals the plan. Exact
  table bytes and final reference agree with the reconstructed plan. Cancellation
  preserves custody reads, membership loss refuses them, and staging adds no
  provider calls. This scenario has one contribution; the larger unit fixture
  does not establish native large-campaign recovery.
- The native HTTP harmless control passes in 150.75 seconds including runner
  overhead. Returning an off-by-one retained cursor fails the intended real-stack
  assertion in 149.46 seconds. The source is restored. This fault proves that
  the test checks the native cursor returned by the adapter; it does not stand
  in for the separate frame/receipt and permission probes.
- Schema guard controls retain a harmless migration comment. An unaccounted
  column and removed RLS declaration fail their intended assertions. The installed
  catalog has 276 application tables with RLS and 14 application views.
- [Fault records](thematic-staging-mutations.json) preserve the original survivor,
  isolated follow-up, native HTTP results and restored source hashes. Installed
  native staging and live schema reconciliation pass 47 tests.
- Full QA passes 16,988 application tests with 1,395 explicit skips, 382 provider
  connector tests with four skips, lint, configured dead-code checks, dependency
  audit with zero findings, and the webpack production build including TypeScript.
  Ordinary QA does not run live RLS; the separate native checks above cover this
  increment. The complete project isolation suite and branch CI are not claimed.
- Product direction check passes with the existing review-age and version
  reminders. No dates were changed to suppress them. Main remains `8cb534f5` and
  correction PR 112 remains open. This checkpoint is backed up on the owned
  synthesis branch; main integration, combined CI and release remain separate.

## Limits

Native structural tests establish exact storage, scope and retries. They cannot
establish that a caller-supplied frame describes the correct evidence. The
application obtains that evidence through fresh original-history reconstruction;
a future executor must repeat this verification and check authorization before
each dispatch. Neither test category establishes model quality, representative
engagement, agency acceptance or practitioner acceptance.

The reader and planner still keep original inputs and frames in memory. The final
proposal task still carries all contextual evidence and can exceed the supported
maximum task size. Staging neither removes that limit nor permits clipping input.
The synthetic larger fixture is not proof of arbitrary campaign scale. Desktop
and 390px journeys remain required before a visible workflow claim.
