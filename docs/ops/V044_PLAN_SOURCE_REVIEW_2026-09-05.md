# Plan source-review correction and release gate continuation

This supplements the earlier September 5 evidence. No release tag has been
created. The full first-week outcome gate is not complete.

## Completed source-caveat and model-download checks

Clean `1775c472f778b41569336dec135deabf443db1ea` passed local `qa:gate`, including
12,841 app tests, 132 live-RLS tests, production dependency audit, lint,
dead-code policy, and production build. Remote CI 33943136146, live RLS
33943136204, and the v0.43 populated-database upgrade rehearsal 33943434653
all passed on that exact commit.

The ordinary Reports journey regenerated report
`b89f01cc-f523-476b-a6fa-857f295c9cd3` as artifact
`2b277b18-36e6-444d-b854-7b100f51b9b4` and used its native download. The file is
307,829 bytes with SHA-256
`db553f137dca2d37576151ed1e9a71846dbaf0d4f550fcefb755725ba1025354`.
All nine rendered pages were inspected. The false source-band sentence is gone;
page 8 states fatal-only coverage, retains 332 supported fatal crashes, and
withholds serious-injury and combined KSI counts and rankings. Desktop/mobile
screenshots were inspected and console errors were zero. The known split-heading
pagination issue remains queued, not called fixed.

All 44 model files downloaded again through visible native links on this build.
Hashes matched the displayed method hashes or frozen top-level bytes and all
bytes/hashes matched the earlier independent downloads. Desktop and 390px
screenshots show separate methods, retired/inconclusive status, readable hashes,
and no horizontal overflow. Console errors were zero. The capture records
aborted navigation/prefetch requests separately; no model-download request
failed. Do not generalize this to zero aborted browser requests.

Evidence remains under
`~/.local/state/openplan/release-checks/v044-2026-09-05/source-caveat/` and
`final-model-downloads/`. The scientific custody verifier also passed again,
and the frozen v0.39-v0.43 modeling artifacts are unchanged.

## First-week interruption and confirmed source-review claim

Full run `2026-09-05T04-00-46-457Z` began on that clean production build.
First-day setup completed with `outcomeReached: yes`, reproducing only the
known county-label ambiguity. During outside-California setup, the fresh tester
recorded a new issue on an ordinary newly created Oregon plan,
`8116b29b-3978-45b8-a43e-3553e8000f41`.

The screenshot shows an explicit unconfigured-legal-requirements warning followed
by `Sources reviewed 2026-08-23; review due 2027-01-15.` The selected descriptor
has no source URLs, either at descriptor, requirement, or process-step level.
The tester classified this as confusing. Source inspection confirms that the
date is being presented as evidence of a source review that is not established,
so the release controller treated it as a false-output blocker under the
agreed gate. The run was stopped during this second job before any code edit;
it is incomplete, not a passing twelve-job result.

The same unconditional sentence existed on the public plan page. Both now use
one small formatter that requires recorded source links before displaying a
source-review date. Without them, it explicitly says source review is not
established. Sourced descriptors retain their recorded dates. No jurisdiction
special case, legal content, registry date, stored plan, frozen artifact,
approval, or write capability changes.

Two regression cases failed against the old UI. A harmless comment survived all
four focused cases. Removing the no-sources guard failed the workbench and
public-page cases; withholding all dates failed the sourced public-page case.
All mutations were restored. These checks prove the display decision, not the
truth of a registry's cited law, the quality of its review, or browser
reachability. Fresh production verification and a new complete first-week run
are still required. Earlier CI results above precede this latest patch.

The scientific candidate remains retired and inconclusive. No defaults,
acceptance rules, model weights, observation matches, networks, or holdouts
changed. The next whole-product hypotheses and preserved independent-reviewer
disagreement are unchanged.
