# Scoped Planner Agent provider connections — v0.52.0

Release preparation is complete locally; final main CI and the populated v0.51.0
upgrade must pass before tagging. No human sign-off is required. The dated
[implementation history](IMPLEMENTATION.md) preserves initial failures, corrections,
mutations and blind categories. This record makes no completed A0/A1 or v1 claim.

The shipped task reads one selected project's own stored record and may propose a
draft submittal. Personal native connections use scoped bearer capabilities; native
Codex owns authentication. Only the existing authenticated action approval path can
create the draft. Both transports retain frozen request identity, source packet,
model/account mode and original result. Retry never selects another provider or
silently generates a second answer. Private counts and a database deletion guard
preserve the project's provider history.

## Local checks

- Full QA at cba17d556e82: lint, unused-code check, 13,753 passed / 350 named skipped,
  connector 31 passed/two named native skips, dependency audit and production build.
- Shuffled seed 910052 at the same commit: 13,753 passed / 350 named skipped.
- Explicit clean-stack RLS: 379 tests in 46 files passed. The stack was
  openplan-restore-target-2026091050, never the demo.
- 52 Python worker suites passed. Explicit installed-native connector run passed
  all 33 tests, including two actual-binary/local-fixture isolation cases. Worker
  source is unchanged since that c4026ed2 run.
- The final narrow refusal layout/copy correction at 29271e1443d9 passed 64 focused
  tests, TypeScript, scoped lint and a new production build. Release metadata-only
  checks and exact main CI are recorded after preparation.

## Browser and failure evidence

Chrome 152 entered through home, sign-in, dashboard and Projects at 1440px and 390px.
Build identity matched the isolated worktree and listening process before each run.
Candidate 5d831adcc61c exercised UI connection downloads, installed-native account
and catalog detection, actual gpt-5.6-luna ChatGPT-account answers, original-result
reload, scripted direct API answers and approved draft creation. The API fixture
intercepted only Anthropic transport inside the dedicated acceptance process, used
a literal synthetic key and sent no paid API request. No token appeared in the UI.

Held native responses could be cancelled. Lost successful API responses exposed an
identical retry with one provider call total; delayed API cancellation stayed final
after reload. Normal consoles were clean. Recovery consoles contained only the
injected connection reset or 503. Current project/private access, revocation, native
interruption, delivery retries and database races have separate targeted checks.

Final identified browser candidate 29271e1443d9 showed readable deletion refusals
at both widths, returned only retention counts, issued no DELETE after a refused
or unavailable preflight, and preserved the original native answer. At 390px the
inner-container layout check passed normally and with a harmless attribute, failed
when wrapping was deliberately removed, and passed again after restoration. The
initial clipped screenshot and initial surviving unreadable-count mutation are
retained alongside their corrections. The owned server was stopped before release
metadata changes. JSON receipts and inspected screenshots accompany this file.

## Limits

Native support is intentionally pinned to standalone Codex 0.154.0 on Linux with
Node 24 and bubblewrap. Other versions/platforms/backends need their own acceptance.
API fixture parity does not establish live Anthropic quality/availability, and
synthetic project journeys do not establish professional usefulness. SQL races do
not simulate physical power loss or every possible interleaving. Broader chat,
MCP clients, all-core-operation coverage and durable assignments remain open.
Agency approvals, prescribed forms, automatic reminders and independent scientific
validation are unchanged. No hosting, paid infrastructure or paid API use was added.
