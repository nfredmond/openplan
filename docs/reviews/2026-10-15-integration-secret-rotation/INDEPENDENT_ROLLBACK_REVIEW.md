# PR 328 independent review

October 15, 2026 UTC, October 14 Pacific. Read-only source review by the
assigned GPT-6.1 Sol high child. One P2 documentation finding remains. I found
no additional defect in the changed crypto implementation. This is not a
live rotation, queue-recovery or installation-recovery acceptance report.

## Candidate and ownership

- PR: https://github.com/nfredmond/openplan/pull/328.
- Candidate: `ebb39464f1633d4908dbe0bcca5e90ce82bfdeaf`, branch
  `work/integration-key-rotation-20261015`. GitHub reported this same open head
  before and after review, most recently at 04:55:59 UTC. No head drift found.
- Comparison base: `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.
- Assigned tree: `/home/nathaniel/.t3/worktrees/openplan/t3-550de714`, branch
  `t3/review-pr328-integration-key-rotation`. It was clean at `05dd3e8da` and
  fast-forwarded to the fetched `origin/main`, `1b2fefe0f`, before review.
- Candidate files came from `git show` and `git diff` of the exact objects.
  I did not check out, modify or test the original rotation worktree.
- Owned output: this dated review only. No commit, push, GitHub review/comment,
  watcher, service, hosted configuration, migration or secret change.
- T3 child thread:
  `thread:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr328-independent-review-20261015-round1`.
  Task identity under the matching delegated-node naming convention:
  `node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-pr328-independent-review-20261015-round1`.
  The parent retains the authoritative delegate response.

I read current AGENTS.md, the current coordination entries, restart continuation
and delegation brief, the binding contract, roadmap, relevant ledger mappings,
direction review and architecture. The existing M3 recovery scope remains open.
Planner-writing and prove-it apply. The nested-package direction check exits
zero with existing expired registry/matrix reminders, a v0.66.0 review versus
v0.68.0 package reminder, and intervening-source reminders. It does not establish
runtime acceptance or refresh those reviews.

## P2: rollback instructions omit ciphertext-reader compatibility

At the candidate, `openplan/docs/ops/HOSTED_RECOVERY.md:115-131` directs the
operator to select a rollback using schema compatibility, promote it and then
align worker code. `HOSTED_OPERATIONS.md:45-50` repeats that older builds normally
work because migrations are additive. Neither check requires second-secret
support. These are existing instructions in documents this PR otherwise updates.

After step 3 of `SELF_HOSTING.md:125-128`, retained records can require both the
old and new secrets. A rollback to base `1b2fefe0f` satisfies the schema check:
this PR adds no migrations. However, that base's `key-crypto.ts` reads only the
primary secret. Regardless of which single secret the rolled-back process gets,
it cannot read a retained set containing ciphertext under both secrets. Matching
the workers to that older build does not restore compatibility. Strict retained
translation/API credentials refuse; ambient integration loading can omit an
undecryptable workspace override and use the caller's existing fallback policy.

Require ciphertext and protected-configuration compatibility before promotion,
as well as schema compatibility. Once both secrets protect required records,
keep web and credential-reading workers on a build that supports both read keys.
If that cannot be established, use a compatible roll-forward fix. Cross-link
this restriction from the rotation instructions. Do not rewrite retained rows
or queued envelopes to make a rollback fit. This finding follows from source;
I did not execute a rollback or decrypt real records.

## Crypto and recovery observations

The fallback independently invokes the unchanged authenticated parser for each
secret. A usable primary remains mandatory. The optional value explicitly uses
`?? ""`, so an absent previous variable does not accidentally invoke the
helper's default-primary argument. Both secrets retain trim/minimum-length
rules; identical trimmed secrets avoid a second attempt. New encryption still
uses only the primary. Authentication completes before plaintext returns.

The parser retains v3 workspace AAD and the v1/v2 compatibility boundary.
Relabeling v3 as v2 does not remove its existing GCM authentication requirement.
Legacy v1/v2 ciphertext remains unbound at this layer, as before. Rotation does
not repair that historical boundary. The envelope consumers still validate
encrypted identity/configuration, and strict translation selection refuses a
failed decrypt rather than choosing another payer. Ambient context fallback
remains an existing separate policy, not a new permission from this helper.

No read writes stored ciphertext. Translation selection still hashes the exact
selected ciphertext. The corrected backup/restore and hosted-recovery sections
now require protected retention and restoration of both necessary secrets to
all readers before resume. The occupied-second-slot instructions correctly stop
a later rotation when two slots cannot preserve three required secrets. These
instructions do not discover key dependencies or capture protected values.

## Control quality and exact gaps

I independently compared Git-object SHA-256 values against both manifests.
All four `source-bindings.json` entries and all 18
`candidate-source-bindings.json` entries match this head. This checks byte
provenance, not behavior. No test or guard changed during this review, and no
suite, build or mutation controller ran.

The retained controller records four 13-case positive cohorts and 14 targeted
failures. Source inspection shows a harmless comment cohort, byte restoration
between mutants and in `finally`, and a classifier requiring exit 1, exactly one
failed case, the named test and its diagnostic. It also records positive and
unrelated-error classifier controls. These are inspected prior reports, not
newly reproduced passes. The rolling-read mutant targets a synthetic secret
prefix; it demonstrates the named assertion's sensitivity but does not model
real configuration delivery or process replacement.

The remaining gaps are specific:

1. The rotation test opens an old translation envelope and compares its JSON.
   It does not run `prepareWorkspaceTranslationSelection` followed by
   `verifyWorkspaceTranslationSelection` across a primary switch with the same
   stored-row digest. Existing selection tests cover unchanged/changed digests
   under one primary, not that combined rotation boundary. A focused synthetic
   case should assert the query projection, original digest, successful
   verification after switching, and refusal after removing the needed secret.
2. The new API destination check changes the outer endpoint but leaves its
   configuration hash stale. It can fail before checking the encrypted hash.
   Existing API tests separately cover a recomputed outer hash under one key.
   The rotation cohort does not combine recomputed destination/hash with the
   previous-key path, and its targeted API mutant removes only workspace
   identity. A fault removing encrypted configuration-hash comparison needs its
   own named failing assertion if claiming that combined protection was proved.
3. The new rotation cohort does not exhaust malformed salt/IV/tag lengths,
   malformed base64 variants or tampered bodies across both secrets and every
   legacy format. Existing crypto tests cover several malformed/tampered cases
   under one primary. No parser change introduces a new failure found here;
   the evidence should remain limited to its sampled cases.
4. All configuration changes in the focused rotation test occur in one process.
   It does not establish every deployed reader's environment, process restart,
   saved queue recovery, restored-secret availability or rollback compatibility.
   These require parent-coordinated isolated acceptance before any such claim.

No provider request, real secret, database target, backup contents or running
service was inspected. I did not independently establish current CI results,
hosted rotation, live queue behavior, independent-host restore, practitioner
acceptance or full M3/V1 completion. Parent owns fixes, tests and integration.
