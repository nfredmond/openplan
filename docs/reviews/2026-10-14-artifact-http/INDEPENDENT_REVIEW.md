# Read-only artifact HTTP review, October 14

A separate Codex reviewer examines a frozen source snapshot. It does not edit
the implementation, run tests, operate services or inspect the live worktree
while mutation controls run. Its review covers the adapter, original-reference
lookup, handler integration, retained reader and the new tests.

## Findings and responses

The first review finds that headers could describe one selected lease while the
reader reloads a different coherent lease. The reader now accepts an optional
expected lease hash and checks it before output. Direct invalid-digest and
different-selected-lease tests challenge this guard.

The first review also finds that ownership, authority, expiry or deadline could
change while response headers are written. The adapter now checks them again
after headers and before the first product byte. It recomputes the remaining
socket timeout. Four header-transition tests challenge this boundary.

The follow-up frozen review finds no additional concrete adapter defect. It
identifies a vacuous test assertion: one read capped at 16 KiB cannot establish
that an eight MiB response is incomplete. The test now drains the closed socket
to EOF under a finite deadline and compares the complete response body with its
declared original length. Fresh four-cohort controls on both interpreters pass
after this correction. The prior snapshot and failed trials remain private
evidence, not acceptance of the corrected source.

## Review limits

SQLite retains its existing bounded transaction wait. A short HTTP stage
deadline may expire while the wait completes. Output checks refuse afterward;
this is not a hard whole-request deadline guarantee.

The review does not establish native RLS, public DNS/TLS, default-worker
integration, photogrammetry quality, placement, browser, practitioner,
independent-host or V1 acceptance. Native and runtime checks remain separate.

The native-script review finds two further issues: source selection relies on
a list position and count, and REST cleanup failure can skip PostgreSQL cleanup.
The current runner checks the restored database name, original capture hash,
every migration version and actual authority body. Independent cleanup attempts
retain both error diagnostics. Five preflight faults and four cleanup faults
challenge these corrections. Native HTTP cohorts remain separate from the
cleanup mock controls.
