# Browser acceptance with installed translation permissions

September 13, 2026. Continues 255a0119 in the owned translation-command-workflow checkout. The preceding goal turn made progress by repairing all seven remaining unit failures and passing 14,856 unit tests. This increment changes only acceptance scripts and evidence, not application code, schema or worker configuration.

## Installed harness and protection

`run-translation-editor-browser.py` now requires 336 migrations through 20261014000017, authenticated command execution, no anonymous command execution, and no direct client translation write privileges. It reads the installation and both ACLs before and after the child. It never grants or revokes anything. Normal exit, nonzero exit and launch failure still verify the installation is unchanged; a mismatch is a failure, never a silent repair.

The editor/access children require the installed migration head. Both wait for the actual Setup tab URL after navigation, so late navigation cannot reset keyboard focus or the editor's scroll position. Current result files use `installedPermissionsPreserved`; historical `grantRevoked` artifacts remain historical and are not rerun evidence.

The wrapper's four controlled tests passed. Baseline and harmless source change survived, and six source faults failed: missing installation check, missing staff/anonymous/direct-write protection, missing post-child preservation check, and lost child exit code. Four real installed-state child probes completed, covering normal and abrupt exit for both editor and access scripts; permissions stayed unchanged. They did not launch Chrome. The initial unit read-only assertion incorrectly matched quoted UPDATE/DELETE privilege names as writes; stripping SQL string literals corrected that test before reporting success.

## Real manual workflow

Actual Chrome journeys entered through the front door, signed in, navigated Engagement, created synthetic campaigns through the UI and entered Setup. Both desktop 1440px and 390px passed keyboard manual save, unsent draft reload, storage quota, differing and unreadable copies, interrupted archive, lost response and local request deletion, exact retry, competing correction, withdrawal/recreation, receipt reasons, original source/history and JSON download checks. The original stayed retained after corrections and withdrawal.

Desktop campaign: acbd0e72-ae60-438e-87ea-2172f8470bf0, capture prefix `translation-editor-1440-1789352021622`.
390px campaign: e0d0966f-307a-4a9f-8527-fc510f1cb3e7, capture prefix `translation-editor-390-1789352091047`.
Structured source hashes, capture/download hashes, geometry and installed state are in `translation-installed-editor-evidence.json`. Full private results and pictures are in `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.

I inspected the desktop unconfirmed-request screenshot and mobile unconfirmed-request and retained-history screenshots. Retry/download controls wrap within the viewport. The mobile history remains tall and dense, requiring scrolling; this is not a claim of ideal phone usability. Document width equals viewport width in both runs. There were no page exceptions. Each run recorded two intentionally aborted command requests and one expected 409 correction conflict. CSS/font preload warnings were also recorded. Navigation-aborted map/history requests are retained in the private logs, not erased.

## Real access and console finding

Baseline and harmless access journeys passed at both widths. Staff exact replay returned 200 without changing retained history. Viewers read current wording, but history and writes returned 403 and no private contents. Outsider list/direct navigation did not reveal the campaign; its three APIs returned 404. Anonymous API calls returned 401. I inspected the mobile viewer screenshot: it shows the read-only explanation and current wording with no edit controls.

Two deliberately leaked response bodies failed the named browser assertions: viewer history and outsider snapshot. Every case preserved the installed grants. These faults test browser assertions, not the server authorization implementation; installed RLS is separate evidence. `translation-access-browser-controls.json` records the four terminal outcomes. The baseline capture prefix is `translation-access-baseline-1789352233762`.

**The access console is not clean.** In addition to expected 401/403/404 responses and preload warnings, both outsider widths emitted React's error about rendering a script tag as a component. A separate read-only Chrome control reproduced the same error at `/engage/synthetic-missing-translation-console` with HTTP 404; `/` returned 200 without console errors. That demonstrates a shared not-found-path issue rather than evidence of a private translation leak. The root layout contains an inline theme bootstrap script, but that is only a candidate cause, not a demonstrated diagnosis or fix. No theme or framework code was changed. Private detail: `translation-not-found-console-control.json`. Recheck and resolve or bound it against the eventual production build before making clean-console claims.

Node syntax checks and diff check passed. Previous full unit/RLS results remain the preceding checkpoints; this script-only increment did not rerun full QA, workers, shuffled tests or production builds. No main merge or release is claimed.

## Resume next

The browser wrappers are now safe to use on installed 336/17. Do not revert to the historical temporary-grant version. Original checkout and demo remain outside this lane. Identify port 3260 with which-openplan.sh each time; current evidence identifies the live owned Next dev launch, not a stamped production build.

Next finish the actual generation request -> durable local worker -> retained output review -> publication journey, including retries at desktop and 390px. Reuse the real SDK transport interception and worker journal machinery already in `translation-worker-live-child.ts` and `translation-generation-worker.ts`, but do not run the old child unchanged: it is pinned to proof port 38962 and a synthetic encryption secret. The current application API is 29821, database container is supabase_db_openplan-restore-target-2026091050, and its installed postgres database is 336/17. No generation fields were present when inspected in this turn; recheck before starting a worker so it cannot consume someone else's queued work. No worker was started and no model calls were made here.

The inspected synthetic workspace had no workspace_integration_keys rows; deployment fallback availability was not checked. Use the actual configuration UI and a synthetic local test credential where needed. Intercept only the expected provider transport, refuse all unexpected network destinations, preserve existing settings and never make a paid call. The separate activation proof DB and older worker proof DBs are not interchangeable with the application stack.

Remaining editor recovery gaps and public comment generation durability/privacy remain open. Then finish relevant QA, shuffled, worker and populated upgrade checks; inspect CI on the final main commit before tagging. Continue to the full V1 contract without human-review release gates or paid infrastructure.
