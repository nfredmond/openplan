# First-week browser reference compatibility

Release acceptance remains incomplete. The full run
`2026-09-06T01-43-19-736Z` used clean, pushed `f4fc039f`. Setup, neutral
jurisdiction and engagement reached their outcomes with no recorded console
errors. Project job 02 reported yes but recorded six script errors, so it is
not accepted. Safety was intentionally interrupted and later jobs failed server
preflight. Original results, downloads and console records are retained.

## Cause and bounded correction

The earlier report-navigation defect is fixed. An actual mouse click in the
report preview reaches the host project page with no console errors at desktop
and 390px. The sandbox remains `allow-same-origin` and stored HTML contains no
script tags or inline event handlers.

The remaining errors come from the pinned Playwright MCP 0.0.79 dependency,
Playwright 1.63.0-alpha-2026-08-05. Its `Tab.targetLocators` normalizes snapshot
references before acting. On this scriptless frame, normalization causes six
blocked-script errors. The same browser, report and application produced:

| Action | Console errors | Host navigation |
| --- | --- | --- |
| Direct frame locator | 0 | Correct |
| Snapshot, then mouse | 0 | Correct |
| Raw snapshot reference without normalization | 0 | Correct |
| Normalized reference, then click | 6 | Correct |
| Normalized reference, then mouse | 6 | Correct |

The QA launcher now keeps exact cross-frame `f<number>e<number>` references
without normalization. Main-frame references, CSS and role selectors delegate
to the original method. Initialization, input order, descriptions and exact
targets remain intact. Both Codex and Claude use this launcher and the same
lockfile-pinned dependency. Unknown versions and missing exported methods fail
startup. The application's sandbox, console gate and write paths are unchanged.

## Verification and limits

Forty-six existing runner checks and six adapter checks pass. The launcher test
calls the actual exported MCP single-target method, not just a mock of our
wrapper. A comment-only mutation survives. Thirteen real mutations fail for
their expected reasons: missing MCP or browser version checks, missing method
contract, normalization, widened reference scope, wrong target, lost description,
premature initialization access, reversed input order, dropped upstream options,
omitted launcher hook, and either runner reverting to npx. All are restored.
The focused command now runs in the main CI job.

The prototype's actual MCP tool journey also passes with zero errors; disabling
the adapter reproduces all six errors and fails the unchanged console check.
Unit tests cannot establish browser behavior, layout, model accuracy, downloaded
bytes or arbitrary future upstream compatibility. Rebuilt final-launcher browser
proof and another complete twelve-job run remain required.

Evidence lives under `~/.local/state/openplan/release-checks/v044-2026-09-05/`:
`browser-compat-*`, `report-link-exact-mcp-*`, and `report-link-real-mcp-*`.
The original model candidate remains retired and inconclusive. No frozen study,
holdout, scientific acceptance rule or default changed.

## Previous checkpoint checks

Exact `f4fc039f` remote CI 34004102059, RLS 34004101979, upgrade 34004109728
and nightly 34004110965 succeeded. Local full QA first failed two live-RLS setup
requests with invalid upstream responses. No service or source was changed;
standalone RLS then passed all 135 checks and the full retry passed 12,993 app
tests, 135 RLS checks, lint, dead-code checks, production audit and build. The
initial failure remains unexplained, not erased as a pass. Developer dependency
audit still has ten known findings. These results predate the launcher correction.
