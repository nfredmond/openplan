# Thematic proposal conversion checkpoint

October 1, 2026. This internal processor starts the receiving end of the
[connected thematic workflow](THEMATIC_NEXT.md). It does not enable generation,
retain a machine proposal, import a staff revision or complete M9b.

`synthesis-thematic-proposal.ts` checks a provider response against the complete
retained source and supplied context evidence. Every selected item or survey
answer must occur in a proposed group or an explicitly reasoned unassigned entry.
Repeated membership inside a group, unknown contributions, silent omission and
assigned/unassigned contradictions fail. Different groups may overlap. Code
computes unique assigned and overlapping contribution counts.

Each proposed membership cites an exact substring of a retained machine context
note for that contribution. These are citations of machine interpretation, not
direct quotations attributed to participants. The original context history must
remain available so staff can inspect its original-source citation chain. This
substring check cannot establish that an interpretation or group label follows
from the evidence.

The processor preserves the original provider output bytes, the input and task
hashes, contribution-specific context references, all preceding uncertainty and
new thematic uncertainty. It rejects unfinished responses, output beyond the
retention ceiling, incomplete schemas and extra fields such as model-supplied
counts or approval. New proposal prose must be well-formed text without NUL;
original context strings retain their original values. Results remain
`machine_unreviewed`. No staff identity, revision or approval is created.

## Trust boundary and unfinished work

The supplied input manifest and context descriptors are internal trusted inputs,
not authentication. Their hashes are not signatures. Before exposing this
processor through a route or worker, a retained-input reader must reconstruct
them from current-authorized original histories, bind one common source and
parent selection, and retain a sealed manifest. Never accept these descriptors
from a browser as evidence of authentic context. The tests use synthetic trusted
descriptors and do not claim that native boundary exists.

The complete original source and context records also need bounded, resumable
thematic task preparation, its own versioned recipe, native request scope and
fresh resource authorization. Machine notes alone are not lossless original
input. Exact output custody, history and retry recovery remain necessary before
staff can import a proposal into a new reasoned revision with an exact expected
parent. Existing approvals must remain attached to their original revisions.
The Analysis interface and identified desktop/390px journeys remain unfinished.

## Checks and limits

The focused converter and existing review suites pass 47 tests. They cover 302
mixed contributions, survey-only input, Unicode and long notes, overlapping and
unassigned membership, immutable caller input, original byte retention, incomplete
responses, output limits, invented/cross-contribution quotations, duplicate and
missing inputs, and machine authorship. Focused lint and typecheck pass.

The combined checkout passes `qa:gate`: lint, configured dead-code checks,
16,775 application tests across 1,378 passing files, 382 connector tests, zero
reported dependency vulnerabilities and the production webpack build/typecheck.
The application suite explicitly skips 1,173 tests across 71 files; the connector
suite skips four. Local full native isolation was not enabled for this pure
processor change. The preceding context-history commit has passing exact-commit
application CI and full native isolation, as recorded in [verification](VERIFICATION.md).
This new commit's GitHub checks are separate. The local log is retained outside
Git at `~/.local/state/openplan/approval-resume-2026-09-27/t3-thematic-qa.log`.

[Mutation evidence](thematic-mutations.json) preserves both runs. The harmless
comment change survives. Initially, removing the duplicate-context guard also
survived because a separate reused-request check rejected the same fixture. The
fixture now repeats a contribution under a different request ID, isolating the
intended failure. In the final run, each of the 27 targeted faults produces an
assertion failure and the harmless control still passes. The source is restored
to its recorded hash. This does not establish native custody, authorization,
provider quality, semantic completeness, representativeness or human usefulness.

The worktree integrates the UI agent's `e15e2b93` main checkpoint. Its own dated
implementation log remains the source for its browser evidence and limitations.
The independent-fixes branch retains ownership of its corrections and landing.
No canonical checkout, demo, another agent's stack or browser was changed here.
