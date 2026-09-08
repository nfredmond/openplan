# Control repair and development release policy

September 7, 2026. Nathaniel authorized implementation after the OWP agent finished.
Starting GitHub main was `3faf4af8`, merging PR 103. PR 102 and PR 103 were merged,
no PRs remained open, and CI, RLS and Upgrade Path succeeded on that starting main.
The local checkout was fast-forwarded from `398d8f0d`; unrelated work was preserved.

## Changes and reasons

- The updater's candidate copy dereferenced the tracked `.agents/skills` symbolic
  link into a directory. Its own dirty-tree guard then rejected that candidate
  before fetching. The retained September 7 failure contained exactly this mismatch.
  Copies now preserve links. Each attempt retains a start time, build log and
  failure reason, available again from Diagnostics.
- Control has Demo, Development and Diagnostics tabs, a fixed visible activity
  area, consistent colors and spacing, and supports 820x760 and 640x700 desktop
  windows. Technical status and recovery live in Diagnostics. No toolkit or runtime
  dependency was added. Process ownership and retained-source recovery remain.
- Nathaniel explicitly authorized proportionate development releases for the
  current zero-user stage. `DEVELOPMENT_RELEASE_POLICY.md` supersedes blanket
  all-twelve release requirements. Partial outcomes and scientific limits remain.
  Strategy expiry and intervening commits produce reminders, while evidence
  integrity, frozen hashes and unsupported promotion checks remain blocking.
- Hosted deployment is deferred. Vercel Git auto-deployment is disabled using
  `git.deploymentEnabled: false`. Its official configuration reference is
  https://vercel.com/docs/project-configuration/git-configuration . The unused
  scheduled health workflow is manual-only, and preflight skips unconfigured hosts.

## Verification completed before the live update

- 19 isolated updater integration tests use real Git, files and disposable HTTP
  services, including tracked links, failed build, failed promotion, manual recovery,
  retained artifacts, collisions and changed settings. npm/systemd are fixtures.
- The updater mutation exercise retained a harmless survivor and rejected 16
  targeted broken behaviors, including link dereferencing and discarded errors.
- 28 controller tests passed. Native layout was exercised at both supported sizes
  and Tk scales 1.33 and 2.0, all tabs and keyboard focus. Screenshots were inspected.
  A surviving comment plus output removal, wrapping removal and hidden focus mutations
  established the layout check can fail.
- Twelve focused direction/preflight tests passed. Policy mutation results are
  retained beside this note. The overdue clock test uses 2099 without changing any
  dated source records. The frozen-hash test intercepts a read in its subprocess;
  no scientific file was edited.

## Errors found during this work

The first layout check missed partially clipped labels/buttons because it checked
position against the root window. The screenshots exposed the gap. The test now
checks the tab viewport and requested widget height; the smaller layout was corrected.
Fixture Tk timers are cancelled before destroying each test root. Two accidental
root-level test command launches failed and supply no verification evidence;
accepted app commands ran from the nested package.

## Local database preparation

The configured canonical and demo API URLs both identify the local OpenPlan stack
on port 54321. Before updating, it had 255 of the current 268 migrations. A private
218,911,477-byte pg_dump was retained at
`~/apps/.openplan-updates/before-20260907-engagement-owp.sql`, then the thirteen
additive engagement and OWP review migrations were applied to this local stack.
No reset, drop, model execution, frozen-study modification or hosted provisioning
was performed. The backup has not been restore-tested by this task.

## QA database-write incident and correction

The initial full QA command automatically launched its live RLS step against the
local demo stack. I should have inspected that step before running it. It finished
157 tests but left ten new active synthetic scientific-test accounts and their
fixtures. Three additional accounts were already soft-deleted by test cleanup.
I matched the ten accounts by the exact test prefixes, ten-character hexadecimal
suffixes and the run's creation-time window, disabled them for 100 years and
revoked their ten sessions and ten refresh tokens. A subsequent query found zero
active unbanned accounts from that window. The fixture rows remain; no old user
or scientific study record was removed. Exact IDs and containment output remain
in the private update directory. This is containment, not complete cleanup.

`rls-gate.mjs` now refuses to even inspect a stack unless OPENPLAN_RLS_GATE=1 is
explicitly set. Ordinary QA cannot authorize fixture writes just because a local
service is running. The separate isolated CI workflow is retained. Tests inject
an inert runner and require both zero default process calls and preservation of
an opted-in proof failure. The wrong-target run is not release isolation evidence.

## Pending at this checkpoint

The initial full QA command completed: 13,260 app tests passed, 127 skipped,
zero production dependency vulnerabilities, and the webpack production build
succeeded. Its live-test wrong-target incident is recorded above and is not
accepted isolation evidence. After the opt-in correction, thirteen focused
local-gate and migration-ordering tests passed, and their harmless/broken
mutation controls behaved as recorded beside this note.

Live Control Update-button deployment, post-update browser navigation,
final remote CI and the development tag remain to finish. No completed release is
claimed by this checkpoint. Local detailed logs are under
`/tmp/openplan-control-2026-09-07`; candidate receipts/build logs remain in the private
updates directory. Do not commit raw database backups or application records.
