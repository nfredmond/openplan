# Stop owned aerial HTTP requests when transport ownership ends

Extend original runtime draft dispatch with a callable transport. Bind it to one
explicit original engine identity and credential reference. Send only original
initialization or image-upload commands. Refuse processing commit. Leave live
authority and engine attestation to the caller; do not change deployed defaults.

Run blocking DNS, connection, TLS, send and reply operations in one owned child.
Stream the retained image through a bounded pipe, rather than materializing it
in memory. Supervise the child against the shared deadline and explicit caller
cancellation. A separate parent-lifetime pipe stops the child if its owner exits;
body EOF alone does not end ownership. Kill and reap only this live child object.
Never retry. Parent exit or cancellation cannot prove that a remote server did
not retain bytes; the original command intent stays unresolved.

Check the exact configured engine and permitted command before process launch.
Resolve credentials without adding them to plans or diagnostics. Bound protocol
metadata and response bytes. Verify the streamed image hash before finishing its
multipart request. Return exact status/body bytes to the existing journal checks.
Use direct HTTP without proxy inheritance or redirect following. Actual TLS,
public DNS, live application authority and maximum-job capacity require separate
verification. No processing, output or callback acceptance follows.

Exercise real loopback requests, stalled DNS/send/response, cancellation, abrupt
owner exit, complete exact-byte upload, malformed/oversized replies and no late
request/reissue. Every new guard needs a harmless and targeted broken control.
Restore source mutations in `finally`; run expensive checks serially with owned
resource limits. Preserve the main merge hold and all historical failures.
