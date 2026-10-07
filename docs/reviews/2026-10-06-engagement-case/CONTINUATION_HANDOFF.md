# Context and thematic handoff

This work continues roadmap M9b on
`work/engagement-context-handoff-20261007`, based on `bd292640` from PR #119.
It leaves the execution-permission and progress acceptance checkouts unchanged.
The full v1 contract and remaining roadmap lanes still apply.

## Staff task

After contribution output checks finish, staff needs to combine each contribution
with its complete context, select those completed results for thematic work, and
bring the resulting proposal into the existing staff review. Existing native
operations already retain context and thematic requests. This change exposes
their current-staff handoff without adding another execution system.

The first checkpoint adds the HTTP boundary and contribution picker data. It does
not yet add the browser controls. Browser command recovery, provider selection,
context preparation, per-contribution thematic choices and the full review
journey remain unfinished. This is an implementation checkpoint, not a completed
user-visible capability or release.

## Request boundary

The parent reference includes campaign and workspace scope, original actor,
request-intent checksum, source identity and checksum, selection sequence and
selected-results manifest checksum. The server reconstructs the pinned original
outputs and checks the retained plan before listing contributions or creating a
child request. Incomplete, unavailable or changed results remain a refusal.

The contribution list returns 25 entries per page. Each entry includes its stable
identity, a bounded title or question prompt and a bounded plain-text preview.
The server compares the full contribution membership before returning any page.
The picker does not return structured answer payloads or contact metadata.
Previews do not replace complete source inspection or context reconstruction.
Pagination bounds the response, not the existing in-memory reconstruction cost.

Each creation command explicitly names its stage, new request identity, pinned
parent, provider intent and frame limit. Context commands also name exactly one
contribution. The server passes the current signed-in actor to the existing
native operation and checks the returned child binding. It preserves exact
provider-intent text and native replay status. A parent's cancellation does not
erase retained results or impersonate its former author.

Both HTTP operations require current `engagement.write` access and expected-user
and expected-workspace headers. Writes also require the browser origin check and
refuse unregistered assistant execution markers. Responses use `private,
no-store`; audit events omit source, provider and generated text. The route bounds
body bytes and elapsed request time. It creates no execution permission, thematic
choice, provider dispatch, approval or publication.

## Verification boundary

Focused route, server and portable-contract checks cover substituted parent
identities, source hashes, incomplete output, unsealed plans, omitted contribution
membership beyond the visible page, account changes, late access loss, unknown
targets, altered child receipts, byte limits and request cancellation signals.
Mocked tests do not establish native authorization or browser behavior.

The native probe uses the owned restore-target stack at API port 29821. It reads
the complete two-contribution synthetic parent, saves one context request and one
thematic request, deliberately withholds each first acknowledgement from the
simulated caller, and retries the exact retained command. Both retries return
the same saved bytes with native replay status. Changed parent manifests, changed
sources and unknown contributions are refused. No worker or provider is called.

The native probe does not establish browser storage recovery, HTTP transport
recovery, complete thematic input selection, rendering, keyboard access, console
health, semantic quality, participant representation, staff acceptance or release
readiness. Those boundaries remain separate.

The [verification record](continuation-handoff/verification.json) identifies
application commit `53de593139dbfa3c42796d6869428689853c7d4d`. All 144 tests across
eight focused and source-guard suites pass. TypeScript, changed-source ESLint and
the repository dead-code command exit successfully; the latter retains its
existing advisory inventory. The production build passes from the clean,
unchanged application commit while the Google Fonts network block is active,
with zero blocked-endpoint attempts.

A harmless comment control passes. Eight targeted unit faults fail for the
expected parent/source, membership, plan, account or assistant-refusal boundary.
The source files are restored byte for byte. The native manifest mutation also
fails because the broken reader accepts the altered parent. Harmless and restored
native versions pass. The [unit control runner](continuation-handoff/controls.py)
accepts an application directory and a new output directory. Native commands and
login fixtures remain in the private recovery directory; their probe hashes and
sanitized outcomes are retained here. Native rows remain synthetic fixtures.

The integration audit accounts for 52 local branches, 53 live origin branches and
41 worktrees. Every local branch matches its remote, none lacks a remote, and no
stash remains. Only the unrelated canonical `.directory` is untracked. Five
branches remain outside main, all within the active engagement/font dependency
work. This checkpoint and its PR are pushed. GitHub checks remain pending.

The hidden T3 progress tab still rejects both image and text snapshots. That retry
belongs to the previously built progress candidate, not visual evidence for this
backend checkpoint. The roadmap remains the sole work queue.
