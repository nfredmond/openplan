# Retained preview REST replacement reaches actual readiness

The parent executes the independently reviewed REST-only replacement once. The real preview API now returns 200 for Auth, REST and Storage. CORS returns the expected `http://127.74.19.10:3585` origin. This resolves the local REST readiness boundary; it does not establish an application build or visible workflow.

## Reviewed source and execution

The [prepared recovery](../2026-10-15-final-preview-rest-uri-recovery/README.md) is exact `d71e0aa7aa1b2c3c945ee87a54ea49d6a5772378`. The parent reads the complete [independent review](../2026-10-15-final-preview-rest-uri-recovery-independent/REVIEW.md), exact `159de17faf9da881c77c521baabeb817178f01c3`, and verifies installed templates and manifests before execution. The review clears the REST-only transition, subject to actual preflight, unchanged inputs and single-use operation.

The reviewed preflight exits zero in 11.508 seconds. It checks the exact old REST ID, creation configuration, start state, target OID, unchanged other helpers, immutable source/global fingerprint, prior helper/input bindings and old Storage bytes. The single-use transition exits zero in 25.230 seconds. Its exclusive intents and acknowledgements remain retained. It stops and renames only the owned failed REST container, then creates and starts its replacement with the same original name, image, environment, network and resource limits. The only environment change replaces the REST URI query's literal `+` with `%20`. No clone, SQL write, global repair or other helper restart runs.

The replacement REST ID is `140c68675574a3705fa68aa46543d806d66d1f20739bf63273d6126108d5430d`. The original `cb8cfc278c910f934f495007a85748a740e3b274f977e00e12fe3cc2fa7add16` remains stopped under `openplan-combined-final-rest-64be34b53235-failed-uri-recovery-01`. Neither is deleted. The exact replacement receipt is persisted before startup. Active four-service receipts and their hashes are complete.

The real `active-check` exits zero in 10.447 seconds. It reacquires actual service identities, configuration, HTTP readiness and CORS, then repeats immutable source/global, earlier helper/input and old Storage checks. The source fingerprint remains `82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`. Auth, Storage and Kong retain their exact creation projections, start times and restart counts. Each active helper retains its 512 MiB memory and matching memory-plus-swap limit. The PostgreSQL server remains outside these client/helper resource scopes.

## Independent parent readback and preservation

A separate parent capture makes real loopback HTTP requests after active-check. Auth GET, authenticated REST HEAD and Storage GET each return 200. Both own-origin and prior-origin OPTIONS return 200 with the fixed new preview origin. The prior origin does not receive an allow-origin header matching itself. Native URI connection success is not used as the readiness oracle.

The readback accepts a harmless note and refuses a substituted REST 503 at the named health assertion. Exact Docker inspection confirms the stopped retained container, distinct running replacement and unchanged other three helpers. No browser or application request runs.

A complete packet inventory compares the independent review's 18,485 preexisting files and symlinks against the post-transition packet. No preexisting byte, mode or symlink target changes, and no entry disappears. Exactly 17 new files appear, all reviewed transition intents, acknowledgements, logs or active/replacement receipts. The comparison accepts an extra evidence entry and refuses changed hash and mode specimens. It does not follow the borrowed dependency symlink; logical source/global/Storage preservation is established separately by the original immutable guards.

[Sanitized evidence](evidence.json) records the actual statuses, IDs, hashes and packet comparison. Raw evidence remains under `/home/nathaniel/.local/state/openplan/rest-recovery-parent-operation-20261015-01`. The three operation units each enforce 512 MiB memory, zero swap and 50 percent CPU. Tool-returned systemd summaries report rounded peaks of 55 MiB, 49.6 MiB and 52.8 MiB, respectively, with zero swap. These rounded unit values do not measure aggregate database memory or establish application capacity.

## Build/start remains separate

Independent finding F1, P2, remains open for the old build/start recipe: its dependency symlink is writable, and `clean_env()` drops inherited npm-cache settings. Resource limits do not enforce filesystem isolation. The parent does not run that recipe or build the frozen 06a app.

A separate application-only packet is being prepared for exact `67828c17c`, including the reviewed workbook correction. It must enforce read-only borrowed dependencies and actual private cache writes, preserve helper head 06a separately from application head 678, bind the real active receipts, and pass a new independent review before checkout/build/start. Existing original files, database ownership and helper configuration remain fixed.

No production build, web start, authenticated application journey, desktop/390px capture, browser download custody, human Calc/Excel use or planner acceptance is claimed. Frozen06a full QA and exact-main ced6 CI/delivery remain separate dated evidence. No hosted configuration, migration, provider, main merge, release tag or default-worker change occurs.
