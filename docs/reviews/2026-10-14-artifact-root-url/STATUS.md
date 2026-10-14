# Artifact root URL correction, October 14

The retained artifact adapter previously accepts a public URL path prefix.
It generates a prefixed download URL while the built-in HTTP handler and path
parser serve artifacts at the root. That configuration produces an inaccessible
link unless a separate proxy rewrites the path.

The adapter now requires an empty or root path. It rejects unserved prefixes
before lease publication. A trailing root slash remains valid and normalizes to
the origin. Existing lease identity, actor checks, expiry and byte checks remain.
The fixture now uses the root URL served by the HTTP adapter.

Four 48-case source cohorts and 51 intended faults pass on each of Python 3.14
and Python 3.11. Four 34-case HTTP cohorts and 35 intended faults also pass on
each interpreter. Their source bindings match this restored checkout. Authority
and product descriptors remain fixtures; the HTTP sockets are real. A first fault trial correctly
exposes a bad lease but later fixture calls hit the lease-renewal guard. The
corrected fixture separates the full publication check from further URL parsing
cases. Only the intended publication diagnostic can satisfy the fault oracle.

This is a configuration correction for the explicit candidate adapter. It does
not activate a worker default or establish public TLS, proxy, hosted, browser,
photogrammetry or V1 acceptance. Read validation uses the same URL check. Prefixed leases require explicit
recovery; their original bytes remain preserved.
