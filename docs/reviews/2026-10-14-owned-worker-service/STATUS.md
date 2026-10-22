# Explicit owned worker HTTP service draft

The opt-in service joins the explicit original Bundle to HTTP admission and a
single owned execution loop. Callers supply operator settings, address, inbound
credential and the existing credential/options adapters. The service reads no
environment itself. It changes neither the legacy entry point nor hosted settings.
A CLI, installation procedure and older-root adoption remain separate work.

The lifetime writer is acquired before the socket binds. Requests require the
active original runtime. One exact request keeps one durable accepted receipt;
changed payloads receive conflict, and a full pending queue refuses new work.
Admission preserves the existing contract and calls Bundle.submit. Artifact GETs
use the existing guarded download adapter. Health reports process availability
and keeps application acceptance unassessed.

The HTTP surface caps simultaneous handlers and declared body bytes. Header and
body reads have absolute deadlines, including clients that keep sending bytes.
Ambiguous framing and malformed JSON refuse. Authorization compares the inbound
credential before body admission. Request paths, bodies and artifact tokens are
not logged. Each response closes its connection.

Shutdown sets the cancellation event supplied to the actual Bundle, stops the
HTTP accept loop, closes owned connections and joins active handlers before the
lifetime owner exits. A two-second wait sets a delayed-shutdown diagnostic; it
does not release ownership. Cleanup exceptions still drain active handlers. Failure cleanup uses captured original server/runtime
objects. Repeated runs and changes to the pinned component/settings graph refuse.
A service that stops before starting never listens.

## Source and loopback checks

On each of Python 3.14 and 3.11, the current worker/test bytes pass four 30-case
cohorts and 32 intended faults. These include actual loopback admission/replay,
unauthorized requests, queue conflicts, dripping headers and bodies, concurrent
handler limits and stopped connections. Both interpreters pass 286 related cases after the corrections. The [frozen independent
review](INDEPENDENT_REVIEW.md) closes four concrete findings in snapshot02, with
its static limits preserved. Both campaigns also check their diagnostic oracle
and demonstrate that an unmapped test and a removed census guard are detected.

The first shutdown control is vacuous: a connection could stop before entering
the body reader, so removing explicit connection closure survived. That campaign
remains failed. The corrected fixture waits for the actual body reader before
cancellation; removing closure now fails the intended shutdown assertion.
An intermediate campaign uses a stale broken-body anchor after the reader moves
into a method. Its unrelated failure is rejected and stays historical. All
mutation paths restore source and test bytes in `finally`.

These tests run the real Bundle on empty private roots and actual local HTTP.
They do not run native engine processing, full application callbacks/Storage,
public TLS, default activation, capacity, planners or independent installation.
The queue and connection limits are technical bounds, not measured capacity.
Older non-sealed roots still refuse configuration and need explicit adoption.

An actual admission paused inside its guarded runtime keeps the owner after the
two-second diagnostic. Another writer cannot acquire it. Releasing the handler
preserves one durable original receipt and permits shutdown. The same ownership
boundary survives an injected exception after listener shutdown. Actual SQLite
contention returns 503 and creates no admission.
