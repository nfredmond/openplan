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

The first checkpoint adds the HTTP boundary and contribution picker data. At
that checkpoint, browser controls and browser command recovery remain unfinished.
The subsequent context-control work is recorded below. Per-contribution thematic
choices and the full review journey remain unfinished; this is not a release.

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


## Context controls, October 7

Staff can now open a completed contribution request, inspect its saved results,
choose a contribution from the paged list, and use the existing provider-choice
form to save a context request. The confirmed child opens the existing
preparation, cancellation, execution-permission and progress controls with the
context stage. Saving the request itself grants no provider permission.

The layout stays within the selected parent request. It uses Space Grotesk,
existing ink `#1a1a1a`, muted text `#716b63`, white `#ffffff`, accent `#c03f1c` and
secondary accent `#1f6b5e`, with current theme variants. Left-aligned contribution
previews and pressed-state buttons distinguish choices without a new dashboard,
completion badge or automatic motion. Labels and provider destinations wrap.
The saved parent reference appears in retry details where it informs the decision.

```text
Contribution outputs are ready to combine
  Choose a contribution to combine
    Showing [loaded] of [total] contributions
    [Contribution title]     [plain-text preview]
    Context for [selected contribution]
      Saved API connection
      Analysis model
      Save context request
      Preparation and explicit execution permission
```

Browser custody reuses the existing request-recovery module. Slots now distinguish
root creation, cancellation, parent request, stage and contribution. The saved
command retains its original provider intent, parent sequence, result checksum
and resource limits. A later selection does not replace an uncertain command.
Staff sees its original parent reference before an explicit retry. Different
accounts, workspaces, sources, parent authors or contributions cannot reuse it.
Native child receipt bytes and hashes are checked before clearing the exact
pending command. A newer command in the same slot survives delayed cleanup.

The contribution picker checks returned scope, full parent identity, page offsets,
total counts and duplicates across pages. Access loss clears private previews.
Changing account or parent remounts the picker, and closing it aborts the read.
These are DOM and protocol checks, not rendered or keyboard acceptance.

The thematic protocol supports exact browser custody, but the thematic request
and complete-context choice controls are not yet exposed in this picker. That
work remains part of M9b. Context controls also still require identified-build
browser evidence before the visible workflow is accepted.

The [context-control checks](context-controls/verification.json) pass 237 tests
across 12 suites, the full TypeScript check and changed-source ESLint. A harmless
comment control passes, and 10 targeted faults fail for the named recovery,
receipt, stage, page or account boundary. Source bytes are restored after each
fault. Production build and identified-build browser evidence follow separately.

## Context recovery in the owned browser build

The production build passes from unchanged commit `8b707f2f`, with Google Fonts
blocked and zero requests to those endpoints. The owned server on port 3483
reports that commit. Its Next process runs from this worktree's application
directory. The [browser record](context-browser/verification.json) preserves
the build, request receipts, DOM measurements and limits.

The desktop journey starts at the application root and follows Overview,
Engagement, the synthetic campaign, Analysis and the retained source. Staff opens
the saved-request disclosure, the completed parent, saved results and contribution
choices. Preliminary read-only activations within a closed disclosure are
discarded; the actual save and retry use exposed controls.

The browser saves context request `daa0abcc-1942-4949-9afd-c7a30c4fed93` for the
long multilingual synthetic contribution. A fetch wrapper captures the actual
201 response, then withholds that acknowledgement. The UI retains the exact
command and displays its uncertain status. After a real page reload and return
through the exposed controls, the same unconfirmed request remains available.
An explicit retry returns 200 with `replayed: true`. The request identity, exact
body hash, provider-intent hash, context hash and normalized saved-state hash all
match the first response. Only then does the pending browser copy disappear.
The form opens the existing context preparation controls. No execution permission
is granted and no preparation is queued.

A fresh 390px page load finds the saved child in request history. Its preparation
panel measures 326px wide, with the inspected buttons inside the viewport. The
earlier resize of the hidden desktop document retained a 240px surface offset;
the fresh mobile load measures a 390px surface with no offset. Both observations
remain in the record. This does not establish correct resize animation.

T3 still rejects image snapshots at desktop and mobile. These results establish
DOM-driven request recovery and saved history, not visual, pointer, keyboard,
console, human or semantic acceptance. Capture after reload starts before the
explicit retry but after opening the contribution, so it does not independently
prove absence of every intervening network request. The server is stopped after
collection and before these documentation edits.

The refreshed integration audit uses main `3e54ecc3`. It accounts for 52 local
branches and 41 worktrees. Every local branch matches its remote. Four engagement
branches remain outside main; the unrelated canonical `.directory` is the only
untracked item. PR #120 is merged after all seven checks pass. All seven PR #119
checks also pass. PR #121 checks and final visible acceptance remain open.
