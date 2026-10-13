# Refuse a reply that ends before its declared bytes arrive

The original draft transport accepts a valid JSON prefix from an incomplete
HTTP response. A real local server advertises 64 bytes, sends a complete 47-byte
UUID JSON object and closes. The unchanged transport returns HTTP 200 and those
47 bytes. A valid object does not establish a complete HTTP message.

Two new regression cases fail on that source with their intended assertion,
`RuntimeError not raised`. The cases cover a valid JSON prefix and an empty
prefix when declared bytes remain. The child now checks the remaining declared
length after its bounded read. It refuses an incomplete reply before publishing
the status/body envelope. The original intent remains unresolved; this does not
prove that the remote engine discarded a request or permit a retry.

The fix preserves a complete close-delimited reply and a complete zero-length
reply. Framing completeness is separate from whether the API body acknowledges
an operation. Byte limits, deadlines, cancellation, parent-lifetime supervision,
credentials, engine binding and original init/upload command restrictions stay
in place. No processing commit, new endpoint or default is added.

Python 3.14 and 3.11 each pass all 35 HTTP tests in four positive cohorts. Six
targeted faults reach their intended failures: removing the check, accepting
unread bytes, rejecting a legal close delimiter, rejecting an empty complete
frame, dropping the short-frame fixture and losing actual request observations.
Twenty-four diagnostic controls per interpreter reject the wrong exit, test or
failure reason. Both production and fixture sources restore in `finally`.
The units stop with peaks of 67,768,320 and 68,247,552 bytes under 256 MiB,
with zero maximum/OOM events and zero swap.

[Legacy observation](evidence/legacy-observation.json),
[legacy regression](evidence/legacy-regression.json),
[3.14 controls](evidence/controls314.json),
[3.11 controls](evidence/controls311.json),
[3.14 diagnostics](evidence/oracles314.json),
[3.11 diagnostics](evidence/oracles311.json),
[restored source](evidence/source-bindings.json),
[3.14 resources](evidence/resources314.json) and
[3.11 resources](evidence/resources311.json) retain the result.

This is actual local HTTP and owned-child evidence. It does not establish every
proxy/framing variant, public DNS/TLS, current application authority, original
engine identity, whole-worker recovery or processing quality. Current main join,
complete worker recipe, native compatibility and exact-head GitHub checks remain
pending. Full M3/M5b.2, practitioner/scientific acceptance and v1 remain open.
No hosted, database, activation or release change accompanies this checkpoint.
Raw logs remain in the private `odm-reply-framing-20261013` proof directory.
