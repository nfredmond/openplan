# Supervise original aerial source downloads

Continue M3 and M5b.2 above retained URL source custody. Provide an explicit
callable GET transport for the existing counted writer. Do not change the legacy
fetcher, admission defaults, public schema or deployed worker configuration.

Run blocking DNS, connection, TLS and response reading in one owned child. The
parent checks cancellation and deadline while streaming bounded chunks to the
existing writer. A separate lifetime pipe ends the child after abrupt parent
exit. Kill and reap only that child. Incomplete downloads stay unaccepted.

Parse each URL before DNS. Refuse credentials, fragments, control characters,
unsupported schemes and unapproved ports. Resolve once per hop, validate every
address against public unicast or explicitly configured installation networks,
then connect to a checked address without another DNS lookup. Preserve the
original Host header and TLS hostname verification. Manual redirects have a
fixed upper bound and repeat the full policy; close redirect responses without
waiting for their bodies. Refuse HTTPS downgrade. Do not inherit proxy behavior,
request authorization headers or cookies. Signed query values remain private.

Require a complete successful response and exact framed byte delivery. Refuse
encoded bodies and ambiguous lengths. Count actual stream bytes before writing
excess data, check declared length and verify the child's final count and hash.
The child sends no completion marker for an interrupted response. The original
source receipt still publishes only after durable independent local validation.

Prove actual loopback requests, redirects, cancellation during body/header work,
stalled DNS, child reaping and parent exit. Prove malformed URL, address/port
policy, bounded writes, framing and source-custody integration. Include harmless
and targeted broken controls with exact restoration. Controlled local sockets
and synthetic bytes do not establish public DNS/TLS, image decoding, live
authority, scientific, browser or whole-worker acceptance. Main merges stay held.
