# OpenPlan v1 resumption in T3 Code

October 1, 2026. Nathaniel authorized continuation of the existing full-v1 goal
and a separate independent review thread. This record documents ownership and
the immediate implementation dependency. The [roadmap](../../ROADMAP.md) remains
the sole queue and the [v1 contract](../../product/V1_PRODUCT_CONTRACT.md) remains
the destination.

## Starting point and ownership

The released baseline is v0.66.0 at `bc47c0ce`; its publication documentation
and current main are `891a0d89`. The earlier session paused four context-history
prototype files off main. Their saved hashes matched before this work resumed.
The final publication RLS workflow has now been checked and passed.

The implementation thread owns `work/engagement-synthesis-generation` in the
existing translation-command worktree, including the context-history readers,
continuation error handling, their fixtures and verification records. Native
tests use only the named `openplan-restore-target-2026091050` stack. The running
demo, canonical checkout, independent reviewer files and unrelated changes are
outside this ownership. Coordinate a handoff before another thread edits these
files or collects acceptance against this build.

Nathaniel subsequently confirmed concurrent Claude and Codex implementation in
other worktrees. The independent-fixes worktree now covers the reviewed security,
provider, financial and worker/scientific corrections; the UI/UX worktree owns
its interface and auth callback changes. Those changes remain unverified by this
thread. Keep the synthesis lane separate. Both synthesis and independent fixes
extend `openplan/package.json`'s native-test list; preserve both sets at integration.
The shared local ownership record is `~/.local/state/openplan/COORDINATION.md`.

## Immediate plan within M9b

1. Reconstruct retained context as the currently authorized staff member.
   Authenticate original frames, dynamic inputs, grants, captures and selections;
   replay the final frame; preserve incomplete states and original authorship.
   Distinguish read races, invalid model output and internal faults.
2. Establish this reader's boundaries through focused tests, deliberate faults,
   native database permissions and authenticated worker/HTTP integration. Run
   the repository gates before landing the checkpoint.
3. Use only complete verified context in thematic processing. Preserve complete
   source coverage, minority positions and uncertainty. Retain machine proposals
   separately from staff decisions.
4. Add explicit import to a new staff review revision, retaining prior approvals
   on their exact original revision. Complete Analysis controls and identified
   desktop/390px journeys before claiming a usable generation workflow.
5. Integrate consequential independent-review findings and reassess the whole
   product before choosing the next substantial roadmap lane. Record exact
   commit CI separately from local checks and tag only an evidenced release.

No new version or delivery deadline narrows the contract. Full OWP administration,
contract drawdown, RTP updates, capital/tax/grant administration, procurement,
engagement, provider choice, shared planning practices and operations remain
required. All-state/DC coverage, explicit territory and tribal authority support,
and separately validated AequilibraE and ActivitySim uses remain required.
Existing inconclusive scientific findings and consumed holdouts stay intact.

## Direction and acceptance limits

`product:direction:check` passes at resumption. It still reports an expired
jurisdiction-registry review and an older whole-product review covering v0.44.
Those reminders require substantive reassessment, not a date-only update. The
independent code review does not automatically constitute product-direction or
scientific acceptance.

This checkpoint changes a server-side dependency and test fixtures. It does not
add a visible workflow, prove useful thematic interpretation, establish live
provider quality or billing, complete public-participant observation, or close
M9b. Browser acceptance belongs to the later connected interface. The existing
demo is not evidence for these uncommitted changes.

See [verification](VERIFICATION.md) for current results, failures and remaining
checks. That record must distinguish local verification, landing and release.
