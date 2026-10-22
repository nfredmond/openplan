# Independent review of PR 328 combined consumer tests

October 15, 2026 UTC. I found no new P1 or P2 defect within the two
combined consumer tests and their retained control evidence. Both source-test
gaps named in the earlier review are addressed. This is bounded source and
synthetic execution evidence, not production rotation or recovery acceptance.

## Exact source and ownership

The candidate is `7cb1239a7aefda601e98e7bbc4c2768f931d22f6`, with parent
`cfdce545f70c2580bf11d4a6253bb48620927a9e`. Git confirms that parent and
shows only the new two-case test, controller and dated evidence added by this
commit. No application implementation changes in this increment.

The assigned isolated tree is
`/home/nathaniel/.t3/worktrees/openplan/t3-6bc4024d`, on
`t3/review-pr328-rotation-consumer-tests`. It started clean at `05dd3e8da`,
then fetched and fast-forwarded to `origin/main`, exact
`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`. Candidate reads use Git objects.
The private execution snapshot comes from `git archive` of that exact candidate.
The candidate owner at `t3-095307b4` remains untouched.

I own only this review directory and private temporary probes. No nested
delegation, application edit in an existing checkout, full suite, build,
browser, native database, application service, hosted operation, real secret
rotation, PR operation, push or merge ran. The parent retains integration.

I read AGENTS, the current first external coordination entries at
`/home/nathaniel/.local/state/openplan/COORDINATION.md`, binding contract,
roadmap, capability matrix, latest direction review, limitations and relevant
architecture. The production merge hold remains in force. The nested app's
`product:direction:check` exits zero, retaining expired registry/matrix,
review/package version and intervening-source reminders. It does not refresh
those records. M3 remains partial. Planner-writing and prove-it apply.

## The translation case exercises the intended chain

The test calls real `prepareWorkspaceTranslationSelection`, rotates the
synthetic environment, then calls real `verifyWorkspaceTranslationSelection`.
It also uses real envelope preparation/opening and Node crypto. The Supabase
factory mock throws if used; the caller supplies a synthetic scoped client.
The selected-key consumer itself is not stubbed.

The fixture checks every table, exact projection and ordered workspace/provider
filter. It returns only requested columns and only a matching row. Omitting
`workspace_id` therefore cannot silently retain that field. The deliberate
projection fault fails the named projection assertion. It cannot establish
live query behavior, permissions or RLS.

Preparation independently hashes the exact original stored ciphertext in the
test. Verification retains that digest, the complete credential JSON and the
row bytes across rotation. Replacing the row with new ciphertext for the same
plaintext refuses. Removing the needed old secret refuses the queued envelope
before another row read. Fresh preparation then refuses the old row despite an
available environment payer. The named payer-fallback fault fails that final
refusal assertion.

The synthetic workspace, request and credential IDs are valid inputs, not
authenticated actors. The production queue passes selection into its request
RPC at `translation-generation-queue.ts:66-76`. The worker checks request and
packet identity and verifies selection before claim at
`translation-generation-worker.ts:123-138`. These callers remain outside the
new test. Actor membership, RPC authorization, durable persistence and claim
races are not established by this helper chain.

## The API case distinguishes the rejection stages

The test prepares a real revision under the old primary, then opens it with
the new primary and old previous secret. It changes the endpoint, parses the
configuration and recomputes its outer SHA-256 hash. Ciphertext, workspace and
revision remain identical. The parsed object and production hash function use
the same configuration order.

The observing `vi.spyOn` calls the actual decrypt implementation. The stale
outer hash refuses before any decrypt call. The recomputed outer hash reaches
exactly one successful decrypt of the original ciphertext. The resulting
plaintext contains the original identity, hash and key. The consumer then
refuses the encrypted configuration mismatch. Removing that comparison returns
the key and fails the named recomputed-destination refusal assertion. Removing
the previous secret instead produces null at decrypt. Those are distinct
observed stages despite the shared public error code.

The production generation adapter additionally binds workspace, revision,
connection, model, configuration hash, packet and attempt before opening the
credential at `provider-api-generation.ts:38-51`. The new test does not execute
that adapter, provider transport or authorization. It addresses the earlier
encrypted-hash rotation gap at the credential consumer boundary.

## Independent controls reproduce the claimed sensitivity

I ran the candidate's exact controller in the private Git-object snapshot.
Execution used one worker, a 1 GiB cgroup, zero permitted swap, read-only
dependencies, private caches and disabled networking. Peak memory was
193,945,600 bytes, with zero OOM events and zero swap use. The controller exits
zero. The full independent JSON reports are retained in [evidence](evidence/).

Baseline, harmless comments in both consumer sources, restoration after those
comments and final restoration each pass both cases. The harmless cohort
demonstrates that the harness can report a survivor. Each fault below fails
one named case with the peer passing, exit 1 and its expected assertion text.

| Fault | Observed intended assertion |
| --- | --- |
| Remove previous-secret reads for bound rows | Prepared selection verifies through the previous secret |
| Hash plaintext instead of stored ciphertext | Selection fingerprints exact original stored ciphertext |
| Omit the selected workspace column | Every read keeps exact projection and filters |
| Ignore retained ciphertext digest | Same plaintext with replacement ciphertext refuses |
| Substitute environment payer after failed row decrypt | Missing needed secret refuses the row despite environment payer |
| Ignore encrypted API configuration hash | Recomputed destination substitution refuses |
| Ignore outer API configuration hash | Stale outer hash refuses before decrypt |

The classifier inspects exact test titles, two result rows, one passing peer,
one failure, no pending case, exit 1, false success and the named assertion
diagnostic containing `AssertionError`. Ten negative classifier controls reject
unrelated/import/runtime errors and incorrect selection/result shapes. The
harmless wrapper survives; a permissive classifier fails its named runtime-exit
refusal. These controls are synthetic classifier checks, not a proof against
every possible malformed reporter payload.

I independently matched all seven candidate final bindings to Git-object
SHA-256 values. The private snapshot matches those bytes after execution,
including the test, controller and five parent-owned consumers. Restoration
runs before each source fault and in `finally`. No existing checkout supplied
mutable execution source.

The candidate retains both rejected controller attempts. Trial 1 lacks the
required named assertion diagnostic because the promise assertion reports a
generic rejection. Trial 2 expects a later spy assertion, but removing the outer
hash comparison first fails the stale-hash refusal assertion. Neither is counted
as an intended kill. The final direct error assertion and corrected earlier
diagnostic match the actual behavior. I rechecked the retained seven accepted
reports with the exact classifier and inspected both rejected report bodies.

## Prior finding and remaining blind categories

The earlier Sol review's P2 concerns rollback to a reader that cannot read both
required secrets. Parent `cfdce545f` adds compatibility restrictions to the
rotation and recovery documentation. This test increment does not undo them.
The earlier malformed-format and process-delivery limits remain valid. There
is no disagreement to suppress and no new implementation defect established.

This review does not establish every v1/v2/v3 malformed envelope, missing
primary behavior, primary-only writes or every identity substitution through
these two new cases. Those broader claims require their separate evidence.
It does not establish route approvals, actor scope, live RLS/schema/grants,
transactions, concurrent row replacement, queue persistence, process restart,
mixed-reader rollout, deployed secret inventory, backups, rollback execution,
independent-host restore, provider responses, CI, practitioner acceptance or
M3/V1 completion. No fault sample or byte manifest closes those categories.
