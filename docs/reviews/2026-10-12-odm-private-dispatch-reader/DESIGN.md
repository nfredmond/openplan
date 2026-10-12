# Read the saved application original before aerial intake

Continue the existing M3 and M5b.2 candidate. The application producer saves
original request text privately. The worker's existing custody pipeline still
uses a supplied capture adapter. Add a private RPC reader for that adapter.
Keep the default runtime and public request contract unchanged.

The operator selects one database API endpoint and credential reference.
Requests send only the original request ID, installation and target identities
to `read_aerial_original_dispatch`. Incoming source or callback URLs cannot
select that endpoint. Credentials travel through an owned pipe to a supervised
child. They do not enter command arguments, durable receipts or diagnostic text.
The adapter supplies separate API-key and optional bearer-token headers. An
opaque Supabase secret key uses its API-key header, without becoming a bearer
token. The [provider's API-key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
defines that distinction. Local header fixtures do not establish hosted gateway
acceptance of a particular key.
The child makes one request and refuses redirects. Ending ownership,
cancellation or the deadline stops and joins that child, including stalled DNS
or response bodies. Remote receipt of an already sent read is not revoked.

Validate the complete response envelope, scope, exact UTF-8 length and SHA-256,
original eight-field job projection and existing processing contract. Bind them
to the current owned admission. Missing, malformed, changed or uncertain reads
refuse. First capture also requires `authorizedNow: true`. The existing custody
pipeline then saves the exact original privately before any source download.
Recovery uses its saved original instead of replacing it from another query.

A later explicit observation compares the fresh RPC original with the saved
local receipt. It returns current access separately. False stays false. Its
timestamp is a server observation, without clock synchronization or a lease.
Neither capture nor observation grants engine transport or processing commit.
An atomic external fence, worker attestation, callback/result custody, full
installation recovery, capacity and identified-build browser journeys remain
separate unfinished work.

Use actual local HTTP for transport, exact byte, header, redirect, deadline and
cancellation checks. Use harmless controls and selected broken behavior, with
exact source restoration. Verify the installed private RPC separately from a
synthetic HTTP server. Keep database, transport, pipeline and hosted acceptance
claims separate. This design does not authorize hosted activation or spending.

The installed-RPC proof reopens only the verified stopped services retained by
the producer's `rpc-cli-09` proof. It checks their IDs, images, purpose, memory,
private internal network and absence of published ports before starting them.
It refreshes fixture tokens privately, restores only its synthetic actor's role
and its own temporarily stalled read function, then stops both services.
The proof uses actual database reads with supplied ZIP bytes and engine replies.
Those supplied adapters are not native engine or external source acceptance.
