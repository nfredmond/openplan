# Review the saved plan edition in staff history

October 7, 2026. This engineering checkpoint adds explicit version selection to the staff land-use plan workbench. It does not declare M1, the development candidate or v1 complete.

The prior workbench chose the current working or adopted version and loaded the installed checklist and current plan identity. It provided no links to open earlier editions. A reviewed version could therefore appear under wording or context added after review.

The detail reader now selects an optional `versionId` from the plan-scoped history. Invalid, empty or repeated selections return 400. A version absent from that plan returns 404 without falling back to a different version. The ordinary URL still opens the current draft, adopted version or latest available edition.

For a frozen version, the reader fetches only its selected snapshot, verifies its hash and plan/version identity, and binds the fresh row to the selected version's state, number and hash. The shared identity reader also continues to serve both public readers. Retained checklist wording, source-review dates and plan context come from the frozen edition. Legacy editions retain explicit missing-checklist and missing-context disclosures. Current plan fields do not establish historical context.

Staff can open version links in new tabs while keeping unsaved text in the current tab. The historical view shows the reviewed title, authority and area, with a separate retained-context panel. Current context and request recovery remain in a collapsed section. A historical selection is read-only. Its current-plan link opens the ordinary workbench in another tab. This view restriction is separate from server write authorization; no permission model changes here.

The existing Add buttons now also honor write access. A shared workbench guard prevents form writes from a read-only view, including a synthetic submit that bypasses a disabled button. Form handlers prevent native submission before checking that guard.

## Verification

The [50 frozen and navigation controls](frozen-workbench/controls/report.json) pass a baseline and harmless comment change. Each of 48 faults fails its named assertion. They cover identity/hash/context checks, fresh-row binding, query projections and scope, historical rules, legacy disclosure, requested-version selection, invalid requests, write/read-only flags, page-to-client query transfer, encoded queries, and new-tab/current-plan links.

The [seven read-only controls](frozen-workbench/readonly-controls/report.json) pass baseline and harmless changes. Removing the write refusal, native-submit prevention or any of three Add-button restrictions fails both current-reader and historical-view cases. Every control restores source bytes. The read-only guard follows the first 50 controls; the final regression exercises the combined implementation.

The [land-use regression](frozen-workbench/regression.log) passes 520 tests in 25 suites. Five native suites remain skipped in that command; their skip status is not native database evidence. The [focused navigation run](frozen-workbench/navigation-focused.log) and [read-only/draft run](frozen-workbench/readonly-focused.log) preserve their narrower checks. Initial new tests required two expectation corrections: the error includes a read-failure explanation, and current context has a disabled Save button when a newer draft exists. The [initial output](frozen-workbench/initial-test-expectations.log) is retained.

TypeScript, changed-file ESLint and the product-direction check pass. TypeScript first caught an unsupported `exact` option in a role locator; removing that option preserves its default exact-name behavior. The [follow-up](frozen-workbench/followup.log) passes 21 workbench and agent-refusal tests. The [initial typecheck](frozen-workbench/initial-typecheck.log) is retained. Direction age and scope reminders remain unchanged.

These tests use projected database mocks, real reader functions and mounted components. They cannot establish live RLS, simultaneous transactions, actual new-tab behavior, desktop or 390px layouts, console cleanliness, usable exported artifacts, legal applicability or practitioner outcomes. Native identified-build reads are recorded below; rendered acceptance remains open.

## Identified build and existing native records

The [production build](frozen-workbench/build-status.json) passes at `2dc8686fbfd694d99fccfb81b642aef2a0526515` in 109 seconds. The checkout stays clean and unchanged. It includes the creation test correction `67b05212`; the merge changes no application files relative to `5f7f0ff9`. The owned server on port 3498 reports the expected commit, and `/proc/2830232/cwd` points to this app checkout.

Twelve [authenticated HTTP reads](frozen-workbench/native-http.json) pass against existing synthetic records on the isolated 29821 stack. They verify default and explicit working-version selection, default latest-frozen and older-version selection, read-only historical behavior, retained identity/checklist/context agreement with the native snapshot, legacy disclosure, and refusals for invalid, repeated, absent and another plan's version identifiers. The frozen database record is unchanged after these reads. Sign-in creates an auth session; the probe performs no plan fixture writes.

The first attempt [stops on an outdated fixture assumption](frozen-workbench/initial-native-fixture-assumption.log). A subsequent native read confirms that the earlier exercise's newer draft is already in public review. The completed check therefore uses that plan's two frozen editions and a separate existing working-plan fixture. It does not claim native evidence for a historical selection alongside a current working draft, cross-user RLS or concurrent writes.

A fresh [T3 browser attempt](frozen-workbench/browser-attempt.json) opens the identified landing page but fails both text and saved-image inspection. Open reports available but not visible, including when requested visible. No desktop, 390px, keyboard, console, download or real-navigation acceptance is established. An alternative browser remains subject to the runtime's explicit-request requirement. The owned server is explicitly stopped afterward; exit 143 records that stop, not an application crash.

## Remaining work

Specific-plan selection and reconciliation with older working drafts remain unfinished. Existing reporting and publication links retain their own version-selection behavior; this increment does not certify a complete amendment/reporting workflow. Full public/export presentation, rendered acceptance and the remaining M1 contract are open. No scientific or legal claim changes.

## Integration checkpoint

The [branch/worktree audit](frozen-workbench/integration-audit.json) accounts for 58 local branches, 59 remote branches and 47 worktrees. Every local branch has a remote counterpart. Nine remote tips remain outside main `80a829c2`. The current history branch alone has unpublished commits; the remaining working trees are clean except the canonical checkout's unrelated `.directory`. No stashes are present. The BCA and engagement evidence worktrees remain untouched.

[GitHub push attempts](frozen-workbench/push-status.json) fail with a remote Internal Server Error, including ordinary retries, a different pack and HTTP setting, a new recovery ref and the same owned ref from the canonical Git context. The new recovery ref is not created. The local connectivity check passes. This does not identify the server-side cause. The verified checkpoint remains committed locally, with no new PR, merge or release claimed. Retry the push before further integration.
