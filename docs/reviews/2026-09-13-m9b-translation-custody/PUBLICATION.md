# v0.58.0 publication

Published September 13, 2026 at 15:32:08 UTC:
https://github.com/nfredmond/openplan/releases/tag/v0.58.0

The annotated tag points to 18c50222b7f9ab440c9274cc5696f70871710679.
Remote tag dereferencing agrees; GitHub reports it published, neither draft nor
prerelease, and the latest release. See publication.json for exact outcomes.

All required workflows and every job passed on that exact commit before tagging:

- [CI: QA, shuffled, workers, modeling and operations](https://github.com/nfredmond/openplan/actions/runs/34764932132)
- [RLS isolation](https://github.com/nfredmond/openplan/actions/runs/34764932217)
- [Populated upgrade from v0.57.1](https://github.com/nfredmond/openplan/actions/runs/34764947796)

VIEWER_CONTROL.md and viewer-final-checks.json include the corrected test query,
real viewer/staff desktop and 390px acceptance, controls, and full local QA.
BROWSER_AND_UPGRADE.md retains original/corrected/withdrawn checksums, interrupted
read/save journeys and unchanged existing rows across the migration. The initial
1b0783ca candidate was never tagged; the demonstrated viewer mismatch was fixed
before release. Code and evidence landed directly on main, with no PR or human
review gate. The original checkout and separate demo were not changed.

Private history and complete new helper output are bounded engineering claims.
Existing caches do not gain completion provenance. Concurrent exact-version
writes, original source wording, reasons, durable generation/retry and spend
accounting remain open. Neither this release nor manual browser wording proves
language quality or the full M9b/V1 workflow.

Next work is isolated at translation-command-workflow-2026-09-13, branch
work/translation-command-workflow, checkpoint153447a5. Complete source/saved-row
pagination has focused/full unit, type, lint and mutation evidence there but is
not merged or released. READ_PROGRESS.md and NEXT.md under the sibling
2026-09-13-m9b-translation-writes review retain the full remaining workflow,
foreign-key lock findings and missing installed/browser acceptance.
