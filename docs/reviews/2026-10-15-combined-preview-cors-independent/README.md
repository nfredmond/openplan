# Round two closes F1 within the reviewed source boundary

Reviewed October 15, 2026 using GPT-6.1 Sol at high reasoning, without delegation.

**Disposition: bounded F1 source closure. No new concrete blocker found in this
correction.** The corrected launcher accepts the fixed configured origin emitted
by the pinned Kong configuration. It still refuses reflected old origins,
wildcards and unknown origins. This review does not approve operational
execution or establish whole-platform, browser or production acceptance.
The parent owns the decision and the remaining operational evidence.

## Exact source, ownership and review base

The reviewed correction is `a72f012ced074cadbfeb8981e2944e056e6373d2`, under
`docs/reviews/2026-10-15-combined-preview-cors-correction/` in
`/home/nathaniel/.t3/worktrees/openplan/t3-162825d6`. I read the full report,
preparation and control summaries, then extracted all four templates directly
from that commit into this review's private directory. Their hashes equal the
submitted manifest and the bound executable private files.

The first review is `93b2aa1fe01df1960dd311a2b51527ce28058eef`, reviewing
`c636b7eecbd66970217421da7bead960f262323b`. Its finding, disagreements and
historical limits remain intact. This review does not turn the original 567
controls into health acquisition evidence.

My assigned tree is `/home/nathaniel/.t3/worktrees/openplan/t3-16396eba`, branch
`t3/review-preview-cors-f1-round-two`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. I fetch `origin/main` and
fast-forward only this branch to `4ea6a8ca3b43c6712952fc4e527a8538237a9adb`.
The direction check exits zero, retaining expired registry/matrix dates,
review-version differences and intervening-change reminders. I do not amend
those records. I read the operating and product direction documents and the
planner-writing, prove-it, Supabase and Postgres skills.

Ownership is limited to this report directory and its ignored `.private/`
subdirectory. The parent's `t3-0f743997` QA process is active at inspection and
receives no interference. No source checkout or earlier packet is edited.
The shared coordination record's main merge hold remains untouched.

## The exact diff addresses F1

Relative to `c636`, `launcher.py` changes its repository path and replaces the
None-only health comparison with `p.health(observed)`. `policy.py` changes the
private packet purpose/root and adds the health policy. The controls route 17
historical health rows through that policy and add 40 acquisition observations.
The mutation driver is new. The remaining clone, helper, checkout, build and
start logic is unchanged in these templates.

`policy.health()` requires exact integer 200 values for Auth, REST and Storage.
It requires the exact configured web origin for the own-origin observation.
For the old-origin observation, it accepts an absent header or the exact
configured web origin. It refuses a missing observation, reflected old origin,
wildcard, unknown origin, empty value, `null`, origin list or changed spelling.
The Kong origin list remains exactly `[WEB]`.

The retained identities remain:

- App candidate `b4dbcac21a58f61bd480ccade4dec69383dacbc7`.
- Source database `openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up`.
- Exact cluster container
  `a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`.
- Source anchor
  `82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`.
- New target `openplan_project_combined_preview_44eed2f8f58a9c7623c1e7e0`.
- API `http://127.74.19.10:29948`; web `http://127.74.19.10:3585`.

These are bound-file identity checks. This review issues no live database query
and does not independently refresh target absence, migration counts or helpers.
The source packet records 419 migrations through `20261017000016`.

## Submitted controls and mutations reproduce

The exact submitted driver produces **607 controls: 508 intended refusals and
99 survivors**. Its harmless comment survives. All nine named faults fail for
the driver's exact expected reason: always-refusing health, skipped health
policy, skipped health request, skipped old-origin request, skipped health in
`verify_services`, the None-only regression, reflected old origin, wildcard old
origin and ignored own origin. Unrelated runtime/value errors do not count as
kills. Function identities, complete control results and template bytes restore.

I also rerun the exact historical templates in separate private copies.
Always-refusing historical `health()` still leaves all 567 original rows green.
The new first 567 serialized rows equal those historical rows. Seventeen health
rows now mean something different because they call the new policy. The other
550 retain their prior scope. The additional 40 rows address acquisition; they
do not establish live service or browser behavior.

## Independent probes reach below the mocked opener

My independent probe preserves the actual urllib opener, request construction,
HTTP response parser, header parsing, HTTP error handling and redirect handling.
It replaces `http.client.HTTPConnection` before any socket call. The replacement
returns raw HTTP response bytes through the standard `HTTPResponse` parser.
Socket creation and subprocess execution are separately blocked. No request
reaches this preview, another preview or a provider.

The campaign produces **80 observations: six survivors and 74 refusals**, through
both real `health()` and real `verify_services()`. The latter retains its actual
receipt and service comparison flow, with unrelated file/container inputs
replaced. Cases include fixed and absent old headers, reflected/wildcard/unknown
origins, empty/null/list/slash values, 201 readiness responses, 503 responses and
timeouts at each of five acquisition positions. GET and OPTIONS redirects cover
301, 302, 303, 307 and 308. Host, method, path, credential/origin headers, timeout,
request count and completed response contexts are checked. An ambient proxy is
present in the test environment and must receive no request.

The exact historical health function refuses the parsed fixed-origin baseline
as `health:oldOrigin`. The corrected function accepts it. The independent
harmless comment survives. Nine additional named mutations are detected:

- Requesting the own origin in place of the old origin fails
  `health:fixed:cors-request-4`.
- Replacing acquired CORS headers with fixed values, or swallowing health
  refusals, loses `health:ownOrigin` on the reflected-own case.
- Skipping `verify_services()` health loses its required requests.
- Reinstating None-only behavior rejects the fixed-origin baseline.
- Allowing reflected or wildcard old origins loses the matching
  `health:oldOrigin` refusal.
- Removing `NoRedirect` loses the GET 301 refusal.
- Enabling ambient proxies changes the first request's destination.

Each trial restores exact function identities, all 80 results and template
bytes. The complete expected failure strings appear in [evidence.json](evidence.json).
These are additional acquisition and propagation challenges, not only calls to
a policy comparator.

## Private bindings match without exposing values

Programmatic reads confirm both manifest hashes, all 14 private file bindings,
all four template bindings and their private modes. They confirm the unchanged
source anchor, byte-identical source and configured-source bindings, and current
configured-source bytes. All three authorized optional values remain present
and equal their bindings and app values. The configuration policy accepts the
bound inputs: GTFS remains `0`, with AI and email credentials absent.

Engine role credential, host and query fields equal the prior packet. Their
URI database paths name the new target. Fresh local tokens have valid HMAC
signatures, expected roles, future expiry and different values from the prior
packet. The signing secret is fresh. Prior helper/input/Storage binding files
and candidate migrations are byte-identical. Expected operational intent and
candidate artifacts are absent in the inspected packet paths.

A harmless parsed-JSON whitespace change survives the audit. Nine in-memory
faults exercise manifest/template/source-byte checks, source-anchor mismatch,
engine credential mismatch, invalid token signature and unexpected operation
intent. Each produces its named failure and restores the audit result. These
checks inspect files; they do not prove live source preservation, valid provider
credentials, token acceptance by a running helper or runtime permissions.
No environment value, secret, database row or raw private log is published.

## Commands, resource envelope and failed probe trials

All synthetic/audit units run serially with these arguments:

```bash
systemd-run --user --wait --pipe --collect --unit=<recorded-unit> \
  -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=32 -p CPUQuota=100% \
  --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --setenv=PYTHONPYCACHEPREFIX=<review-private>/cache \
  /usr/bin/python3 -B <review-private>/<script>
```

Here `<review-private>` is this assigned directory's absolute `.private/` path.
The actual unit names and outcomes appear in `evidence.json`. Script hashes
also appear there. The successful invocations use these exact script basenames:

- `run_submitted.py`: submitted driver and full restoration.
- `probe.py`: independent parsed-HTTP campaign and mutations.
- `bindings.py`: private binding audit.
- `history.py`: historical blind spot and serialized-prefix comparison.
- `audit_challenges.py`: binding-audit survivor, faults and restoration.

The submitted run peaks at 30M; the independent campaign at 102.1M. All units
report zero swap. Python uses `-B`; no shared cache or bytecode is created.
The final public-file scan accepts a harmless note, detects nine injected full
secret or connection URI values, and accepts exact restoration. Final template
hashes, syntax, absence of bytecode and prose punctuation also pass.
Result creation is exclusive. Preserve existing results and use fresh copied
probe directories and output names for a new run.

Four failed reviewer trials remain private with their source versions and
failure notes. One lacks the fake connection's standard `debuglevel` attribute.
One incorrectly expects a retained `HTTPError` response to have entered the
caller's context; the harness now closes that test-owned error response.
One shows that removing `NoRedirect` survives OPTIONS-only redirect tests,
because urllib already refuses those redirects. The final campaign adds GET
redirects and detects the fault. The binding trial initially compares complete
role URIs despite the authorized target path change; the final check compares
credential fields and verifies the new path separately. None changes candidate
code or counts an unrelated error as a fault kill.

## Remaining unknowns belong to operational proof

No SQL, dump, restore, ACL execution, Docker create/start, candidate checkout,
install, build, web process, browser, provider call, PR, push or main merge runs
in this review. Only this review branch fast-forwards, then receives a local
report commit. The prior review and correction packets remain intact.

The independent transport cannot establish real sockets, Kong enforcement,
helper readiness, startup migrations or a browser's complete preflight rules.
Synthetic receipt/container inputs cannot prove actual helper configuration.
Bound hashes do not prevent a privileged or same-user replacement. Historical
source fingerprints do not prove preservation across operations that have not
run. The retained schema, records, Storage bytes and global roles/settings are
not reobserved live here. No whole-codebase audit is attempted.

The parent retains clone/ACL compatibility, actual source/global/helper/Storage
preservation, helper startup/schema behavior, retained account login and record
decryption, provider validity, capacity, exact build/start bindings, and desktop
and 390px navigation, console and artifact evidence. Those unknowns remain open.
This source closure removes the identified F1 objection within the bounded
review. It grants no automatic execution approval or broader acceptance.
