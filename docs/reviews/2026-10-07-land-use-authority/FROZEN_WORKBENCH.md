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

These tests use projected database mocks, real reader functions and mounted components. They cannot establish live RLS, simultaneous transactions, actual new-tab behavior, desktop or 390px layouts, console cleanliness, usable exported artifacts, legal applicability or practitioner outcomes. Native identified-build reads and rendered acceptance remain separate work.

## Remaining work

Specific-plan selection and reconciliation with older working drafts remain unfinished. Existing reporting and publication links retain their own version-selection behavior; this increment does not certify a complete amendment/reporting workflow. Full public/export presentation, rendered acceptance and the remaining M1 contract are open. No scientific or legal claim changes.
