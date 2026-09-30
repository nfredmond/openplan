# v0.65.0 recoverable local synthesis execution

September 30, 2026. This record preserves the local release-candidate evidence.
[Publication](PUBLICATION.md) records the later passing exact-commit GitHub checks
and v0.65.0 tag. Package metadata alone does not establish publication. The
prepublication findings below retain their original evidence boundaries.

## Release scope

This increment retains complete selected-source preparation, immutable task
plans, explicit resource authorizations and original provider responses. The
local worker processes one authorized task or a saved task list. Interrupted
acknowledgements recover the original output. An uncertain dispatch remains
unobserved and does not cause an automatic replacement call. Retried outputs
remain separate from explicitly selected results.

The framework and its lint configuration update to Next.js 16.3.8. Existing
manual source preparation, staff review and approval remain usable without a
model. This release does not complete staff-facing generation, record/context
consolidation or machine-draft import. Draining an authorized task list does not
establish useful interpretation, complete synthesis or agency approval.

The [execution record](EXECUTION_DRAFT.md) and
[coordinator record](SCHEDULER_DRAFT.md) retain controls, demonstrated defects,
corrections and verification limits. Complete M9b remains the next implementation
boundary under the roadmap. All other V1 requirements remain unchanged.

## Upgrade and local operation

Apply these additive migrations before restarting the application:

- `20261014000033_engagement_synthesis_generation_requests.sql`
- `20261014000034_engagement_synthesis_generation_plans.sql`
- `20261014000035_engagement_synthesis_generation_execution.sql`

The candidate contains 354 migrations, three beyond v0.64.0. They add private
request, plan, authorization, attempt, dispatch, original-output and selection
history. Existing snapshots and staff review histories remain separate records.
No automatic synthesis service or paid infrastructure is enabled. Preserve
operator configuration and private worker journals when upgrading.

From the application package, the internal local command accepts an existing
native authorization UUID:

```bash
npm run worker:synthesis-generation -- --authorization UUID --all-tasks
npm run worker:synthesis-generation -- --authorization UUID --task-index 0
```

Replace `UUID` with the retained resource authorization. The command does not
create authorization or provide a staff generation interface. Use the configured
database that owns that authorization. By default, journals live beneath
`~/.local/state/openplan/synthesis-generation-worker`, separated by target,
authorization and task. `OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR` selects another
private directory. Preserve the same directory when retrying the same command.

Exit 0 means the scheduled outputs have acknowledged custody. Exit 2 identifies
an unobserved dispatch or tasks outside the saved schedule. Exit 1 identifies an
error, interruption or refusal. None means the synthesis has passed semantic
review. A new uncertain provider attempt requires explicit retry authorization;
deleting a journal does not authorize another call. Synthetic tests use a local
provider and do not establish live provider billing or physical power-loss recovery.

## Evidence and remaining publication work

The coordinator application candidate passes full QA and shuffled tests with
16,347 passed and 1,021 skipped. All 52 Python worker suites and the 6 GiB
TypeScript check pass. Nine native HTTP cases exercise the real CLI, journals and
database against a synthetic local model. Its controls and fault tests cover
missing tasks, changed journal identity, access-loss recovery, incomplete task
lists and uncertain dispatches.

The first full isolation invocation ended 143 without a test summary. A second
finished with 924 passed, 125 skipped and one mutation-test diagnostic failure.
The corrected sequence assertion passes all 30 focused native checks, including
the harmless control and the deliberately removed request scope. The corrected
full suite passes 925 tests across 73 files, with 125 skipped. These earlier runs
retain their actual outcomes. [Local check records](local-checks.json) preserve
counts, source boundaries and private log hashes.

The first QA invocation after version alignment also ended 143 without a test
summary. No remaining QA process or kernel out-of-memory record was found; the
signal source remains unknown. Its log is retained as incomplete. The retry uses
a separate child process group and records signals and terminal status. It
passes full QA and shuffled seed `775665`, each with 16,347 passed and 1,021 skipped.
The audit reports zero vulnerabilities and the production build succeeds.

[Release accounting controls](release-accounting-proof.json) pass the baseline
and harmless comment control. Five targeted faults fail for a wrong migration
count, missing recorded file, absent release heading, omitted migration disclosure
and absent release row. All temporary edits are restored. This guard verifies
declared migration inventory and operator notes; it does not prove an actual
upgrade or discover an unrecorded external tag by itself.

[Candidate browser proof](browser-proof.json) identifies build
`1NkAyOZSWPDxmlxsNSJu6`, Next.js 16.3.8, base commit `7726b58e` and exact pending
application hashes. The build-identity helper and process working directory
identify the owned checkout. Desktop and 390px cases enter through normal sign-in,
then use keyboard activation to reach Engagement. Both screenshots were inspected.
The heading, creation control and navigation remain visible, with no page-wide
horizontal overflow or console/page errors. The account was created through the
product for the earlier framework check; no campaign rows were hand-seeded.

The harmless CSS control passes. Deliberate overflow, wrong build, wrong version
and wrong source hashes fail for their intended reasons. The initial browser
harness incorrectly expected a 40-character health commit; the endpoint documents
and returns 12 characters. The corrected check compares that prefix and retains
the full base SHA plus source manifest. The initial failure remains recorded.
These checks establish existing navigation compatibility, not a new generation
interface or useful synthesis output.

Read-only upgrade preparation identifies the running v0.64.0 demo and its actual
database, with 351 applied migrations and exactly migrations 33 through 35 pending.
The previous runtime is retained. Exact final-commit CI, RLS and populated upgrade
checks must pass before tagging. Publication and installed-demo identity will be
recorded after those steps, without substituting predecessor CI for this candidate.

No human software-release review is required. Engineering evidence does not
establish practitioner usefulness, representative participation, agency authority
or national model accuracy. AequilibraE and ActivitySim remain separate validation
obligations. The full V1 contract remains open.
