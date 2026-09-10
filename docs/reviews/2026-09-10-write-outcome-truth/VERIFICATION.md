# Write-outcome truth and serving identity — in progress

Base main `d87a04d4`; checkout
`~/.local/state/openplan/write-outcome-truth-2026-09-10`.
Own files: shared HTTP write-outcome helper and its existing callers/tests,
serving identity helper and ops tests, dated evidence. No other session edits
observed. Pending reminder constraint, permissions and scientific methods stay
unchanged. This extends A1a integrity work; no new application module.

## Completed identity checks

`which-openplan.sh` accepted an unknown commit from any same-checkout process,
calling a production build live development source. The new local process probe
requires this application's actual `next dev` launch chain before making that
exception. It reads listener PID, working directory, command arguments and start
identity; it does not read process environments or credentials. Missing, changed,
ambiguous or remote process identity cannot acquire the dev exception.

Five Python tests pass. A harmless comment survives; treating start as dev,
accepting remote lookalike URLs, selecting ambiguous listeners or ignoring reused
PID identity fail the intended assertions. Logs were inspected for those failures.
A disposable local HTTP listener in this checkout is refused when unstamped and
accepted with the matching commit. Restoring the old shortcut causes the unsafe
unstamped acceptance again. This is process/claim evidence, not authenticated
attestation against an adversarial process or proof of a built artifact's bytes.

A real Next16.3.4 development server at port3277 was recognized as `nextDev: true`;
health answered commit unknown and the helper accepted its verified source path.
This server belongs to this task. No unrelated listener was stopped or changed.

## Write-outcome repair underway

The preceding [live PostgREST probe](../2026-09-10-assistant-audit-outcomes/postgrest-probe.json)
shows that both zero-row and multi-row singular-response errors can leave no saved
row. INSERT with representation also rejects an unreadable row instead of silently
committing it. The old shared helper nevertheless answered `created:true`/201.

The replacement `unconfirmedInsertResponse` answers500, claims no creation and
asks the caller to inspect saved state before retrying. Existing measure/RTP
callers use it. Zero-row classification now requires explicit zero-row details;
missing details and multiple rows remain errors. Manual VMT determination
persistence had its own copy of the same unsupported fallback; it now uses the
shared response. No numerical computation, framework selection, claim tier or
model validation criterion changed.

The VMT positive mock previously returned no row and passed only because of that
fallback. It now returns the inserted synthetic row with database identity/time;
positive tests check a returned screening ID, while missing-result tests remain
separate. Focused shared/route checks are underway. Broad tests are an exploratory
regression scan, not final evidence while edits continue. Some existing fixtures
omit PostgREST cardinality details and may need correction to the observed shape.

Still required: complete affected route and UI coverage, meaningful failure probes,
full QA/shuffled checks on final source, browser navigation at desktop/390px,
release metadata and final CI/upgrade before publication. v0.49.2 at base main has
its own running CI and must be released when those declared checks pass.
