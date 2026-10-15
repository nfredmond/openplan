# REST 503 comes from a plus-encoded startup option

Reviewed October 15, 2026 using GPT-6.1 Sol at high reasoning, without delegation.

**The new PostgREST helper cannot connect because its database URI encodes a
space as `+`. PostgreSQL receives `+search_path` as a configuration parameter
and rejects it.** The narrow proposed correction replaces that query-string
`+` with `%20` in this new REST helper's bound connection URI. No repair is
applied. The last observed REST responses remain 503.

## The failure reproduces against the assigned identities

This assigned checkout starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`
and fast-forwards locally, without fetching, to
`06a108010ab39aa42eed4c2bcda3e1371b8aa813`. Its branch is
`t3/preview-postgrest-503-diagnosis`. The direction check runs in the nested
`openplan/` package and exits zero. Existing expired-review, version and
intervening-change reminders remain unchanged.

Ownership covers this report directory and this new private proof root:

```text
/home/nathaniel/.local/state/openplan/final-preview-postgrest-diagnosis-20261015-3fc0f4d1
```

The inspected parent packet is
`project-geography-preview-final-20261015` under the retained GTFS proof root.
I read its launcher and policy, the public final-binding report at
`/home/nathaniel/.t3/worktrees/openplan/t3-6bf6371f/docs/reviews/2026-10-15-combined-preview-final-binding/README.md`,
and the [CORS correction](../2026-10-15-combined-preview-cors-correction/README.md)
and [independent review](../2026-10-15-combined-preview-cors-independent/README.md).
I read AGENTS.md and the planner-writing, prove-it, Supabase and Postgres skills.
The parent's already-fetched monitoring documentation and changelog remain
private and hashed. No external documentation or hosted network request runs.

The exact database cluster is
`a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`.
Its pinned image is unchanged; the target reports PostgreSQL 17.6.
All diagnostic SQL connections address only
`openplan_project_combined_preview_0752bc2e8104b7a40faab27f`.
No source or retained proof database receives a query from this diagnosis.

At 08:49:54 UTC, Docker inspection confirms all four receipt IDs run, with no
OOM kill and zero restarts. Each retains 512 MiB memory, equal memory-plus-swap
limit, and 0.5 CPU. Their configured environment values equal the pinned inputs.
REST is exact container
`cb8cfc278c910f934f495007a85748a740e3b274f977e00e12fe3cc2fa7add16`,
image `sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326`.
The complete service IDs and final inspection comparisons appear in
[evidence.json](evidence.json).

The exact requested authenticated HEAD is replayed once:

```text
HEAD http://127.74.19.10:29948/rest/v1/projects?select=id&limit=0
```

It returns 503 with no body, as expected for HEAD. One GET to the identical
path and query returns 503 and a 119-byte JSON error carrying `PGRST002`.
That response says the schema cache cannot be queried. The request uses the
existing private service credential, no proxy, no redirects and a five-second
timeout. No row data is requested: `select=id&limit=0` remains exact.

## Native connection parsing identifies the cause

The exact REST log repeatedly records `PGRST000` during version and schema-cache
loading, with this PostgreSQL error:

```text
FATAL: unrecognized configuration parameter "+search_path"
```

Raw REST and gateway stdout and stderr remain private. The gateway log records
its declarative configuration load and startup warnings. No gateway repair is
indicated by these observations: the live response carries PostgREST's JSON
error, and native database connection replay independently reproduces the cause.

The new REST URI has this non-secret query component:

```text
options=-c+search_path%3Dpublic%2Cextensions
```

Native libpq percent-decodes URI query values but keeps this `+` literal. The
server receives `-c+search_path=public,extensions`, which names the invalid
parameter. Replaying the exact pinned URI with the cluster's installed `psql`
exits 2 and reports that same parameter. This does not depend on a schema query,
RLS result, REST token, application build or browser CORS decision.

Changing only the query component to this value exits zero:

```text
options=-c%20search_path%3Dpublic%2Cextensions
```

The diagnostic SELECT confirms the exact new target, user `authenticator`,
`transaction_read_only=on`, `search_path=public,extensions` and presence of
`public.projects`. Credentials, host, port and target path remain unchanged.
The successful SQL runs inside an explicit `BEGIN READ ONLY` transaction.
There is no database write or role/configuration repair.

A harmless percent-escape case change, `%3d` and `%2c`, also connects in a
read-only transaction. Restoring the form-style `+` fails again for the exact
`+search_path` reason. Encoding the literal plus as `%2B` also fails for that
reason. An earlier proposed punctuation variant leaves an extra unescaped
equals sign and fails libpq's extra-key/value-separator check. It is retained
as a malformed trial, not counted as a harmless survivor.

The old 417-preview REST configuration matches its existing bound hash. Read-only
inspection shows the same pinned REST image and the same engine credential,
but its database URI has no query component. No request, SQL, log probe or
mutation addresses that older preview.

## The existing configuration oracle misses native URI decoding

`policy.config_observations()` at lines 109–114 uses `parse_qs()`. That function
decodes `+` as a space. The current configuration policy therefore accepts both
the failing pinned URI and the working percent-encoded URI. A separate
`PGRST_DB_POOL=3` input refuses as `configuration:rest`, confirming that this
observation reaches the real comparator. The comparator is unchanged.

This is the specific blind category: form-decoded URI equivalence cannot prove
native libpq startup-option semantics. The existing synthetic configuration
controls do not establish runtime compatibility. The health oracle correctly
refuses the real 503; it must continue to require REST 200. The prior CORS
correction is not reverted or implicated by this connection failure.

## Proposed parent repair stays inside the new REST helper

1. Preserve the original packet, failure records, receipt IDs, URI bindings and
   this diagnosis. Record a separate reviewed recovery transition.
2. Correct only the new REST connection URI's query encoding. Use
   `urlencode(pairs, quote_via=quote)` or an equivalent URI encoder that emits
   `%20` for this space. Rebind the exact changed private configuration bytes.
   Do not change Auth or Storage just because their drivers also accept URI input.
3. Under the parent's operational authorization, reconcile the new REST helper
   with that corrected configuration. Docker cannot change a running container's
   creation-time environment; the parent must review the necessary replacement
   and receipt transition. Do not rerun `services()` or clone again. Do not
   alter the cluster, role credentials, source database or earlier previews.
4. Retain strict identity checks and rerun the real service readiness and CORS
   acquisition. Require the exact REST HEAD to return 200 before application
   build/start work proceeds. Recheck source/global/earlier-helper preservation
   using the existing immutable source anchor.

A bounded future regression should exercise libpq-compatible option decoding,
with a harmless encoded-hex survivor and a failing plus-encoding case. A new
whole-product or security audit is unnecessary for this diagnosed encoding defect.
This report adds no production guard or fix and does not authorize replacement.

## Custody, resource use and limits remain explicit

[evidence.json](evidence.json) binds launcher, policy, source binding, clone-ready,
dump, receipt and failure-file hashes. The dump is exactly 16,232,305 bytes with
SHA-256 `181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398`.
The original source anchor remains
`82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`.
It is read from its retained binding, never recaptured or replaced. These file
checks do not independently prove current logical preservation of source rows,
cluster roles/settings or Storage bytes. The parent owns those checks.

All 16,865 initially inventoried regular packet files retain their bytes and
modes at the final comparison. Two files appear during observation:
`parent-preservation-after-helpers-01.py` and its JSON result. The diagnosis does
not create them. Consequently, whole-directory equality is false; the evidence
does not suppress that result. The initial inventory already contains the
parent's candidate checkout. This diagnosis performs no checkout/build/start
phase in that packet and does not establish the parent's later execution state.

Final read-only Docker inspection finds unchanged configuration bindings, start
times and zero restarts for all four exact new helpers. The diagnosis performs
no service creation, restart, stop, deletion or Docker update. No SQL write,
credential change, full suite, live RLS suite, browser, provider request, PR,
push or main merge runs. The parent's 22,931 passing tests and 1,662 skips remain
parent-reported context; they are not rerun or independently established here.

All diagnosis scripts run serially in user systemd units with `MemoryMax=512M`,
`MemorySwapMax=0`, `CPUQuota=50%`, Python `-B` and no bytecode. The first packet
inventory reaches the 512 MiB cap but finishes with zero OOM events and zero
swap. Later SQL/reproduction units peak at 25.3–28.5M; subsequent inventories
remain below the cap. Logs and connection strings stay in the 0700 private root;
no credential or complete connection URI appears in this report.

One collection initially captures only Docker log stdout and sees no log lines.
The second collection retains both stdout and stderr and exposes the error.
The empty first capture is preserved; it is not evidence of absent errors.

Native connection success does not prove a complete PostgREST schema-cache
load, REST authorization or end-to-end readiness. The correction remains
unapplied, and REST health remains failed. App journeys, browser evidence,
capacity, practitioner use and production acceptance remain outside this
bounded diagnosis.
