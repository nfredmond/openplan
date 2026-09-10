# Development releases and useful evidence

Nathaniel's September 7, 2026 direction supersedes the earlier requirement that
every interim release pass the complete twelve-journey campaign. OpenPlan has
zero users today. Development should produce usable increments and prepare for
feedback from planners. Hosted deployment is deferred; Vercel is inactive.

## What blocks a development release

Release a coherent, described increment when its relevant engineering checks
pass and its changed workflows work. Keep build/install and upgrade failures,
data loss, permission leaks, false consequential claims and regressions in the
promised increment blocking. Retain the existing QA suite and applicable live
database/worker checks. Ordinary local QA must not automatically write fixtures
into a running database. Live RLS remains an explicit isolated test command and
a separate CI workflow; `OPENPLAN_RLS_GATE=1` opts into it from local QA.
Check affected visible workflows in the actual app,
including narrow layouts where applicable. Native Control is a desktop app;
test supported desktop sizes and scaling, not a fictitious 390px phone window.

Every release records what changed, what was exercised, and material limitations.
New user-visible capability normally increments the minor version before v1.
Versions describe shipped development progress, not the percentage of v1 done.
An ordinary local demo update may install current main without a release tag;
show its version and commit and retain the previous working build for recovery.

## How to use the twelve journeys

Keep the existing journey definitions, raw results, partial outcomes and runner
exit semantics. A partial run remains partial. Run affected journeys when useful
for the change, and the full campaign at broad integration checkpoints and before
v1 acceptance. Repeating an unchanged, known-partial campaign after every fix is
not required. An old nine-pass, three-partial assessment does not block unrelated
OWP, engagement, UI or interoperability releases.

The v0.44 experiment stays retired and scientifically inconclusive. Its historical
release campaign failed under the policy then in force. A new v0.44 development
release may include completed improvements under this policy, with those gaps
disclosed. This does not regrade the September 6 run or promote model defaults.

Require a complete outcome before advertising that capability as complete.
Keep scientific validation gates for actual accuracy/forecast claims and the
full v1 destination. An honest inconclusive result is useful software behavior.
Grant-ready safety treatment/cost/benefit analysis and credible forecasts remain
unfinished where their evidence is absent.

## Reviews proportional to the work

Review product direction at meaningful scope decisions, when evidence contradicts
the plan, and periodically as a reminder. A monthly expiry, a new code commit or a later development version
is not an engineering failure. Keep dates and source commits honest; do not
rewrite a review's metadata merely to make CI pass. The direction checker still
rejects broken evidence references, altered frozen artifacts and unsupported
capability promotion. It reports strategy age and intervening work as reminders.

Use independent reviews for substantial product/scientific decisions or changes
whose consequence warrants another perspective. Two new whole-product agent
reviews are not required for every feature, bug fix, commit or minor release.
Existing reports remain historical evidence. Preserve disagreements.

Nathaniel's September 9, 2026 clarification: no human review is required to
implement, verify, merge or release OpenPlan. Do not recruit reviewers, require
PM/finance sign-off or leave verified work unreleased while waiting for human
acceptance. Human-review entries in older roadmaps and evidence describe
unmeasured field outcomes; they are not development or release gates. Optional
user feedback can inform later improvements. Engineering evidence must still
state what was tested and must not claim an unobserved outcome.

This release rule does not change permissions or approval records within agency
workflows. Software release approval and an agency's authorization to spend,
adopt a plan or submit a reimbursement claim are separate actions.

## Local operation now, hosting later

Local build, database, services and demo checks are the relevant deployment
checks. Vercel status is not a required release check. Automatic Git deployments
are disabled in `openplan/vercel.json` and the Vercel project is disconnected
from this repository; production-health polling is manual and
requires an explicit target. Pilot preflight skips unconfigured hosted targets.
Re-enabling hosted deployment requires Nathaniel's direction and concrete spend
authorization before any paid provisioning. Optional hosting configuration is
retained for future use, without presenting inactive hosting as a broken app.

## Continuous development direction

On September 9, 2026 Nathaniel directed continuous work through the current
software gaps until v1.0. Complete the current release, then continue from the
active roadmap without waiting for another request to proceed. Preserve the
full v1 contract, land verified increments directly on main, inspect final CI
and tag coherent releases. Human review does not gate that work. Keep expensive
findings and the next unfinished implementation boundary in repository notes.
