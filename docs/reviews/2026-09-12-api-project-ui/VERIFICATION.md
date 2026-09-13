# Saved API project workflow, v0.55.0

The initial accepted workflow source is 5b84838c86852a228e23ea1a138551581b9132fd.
The final wording replay below supersedes it for the shipped interface text.
which-openplan.sh matched the isolated checkout and local development server at
127.0.0.1:3255. The desktop 1440px and mobile 390px journeys entered through
home/sign-in, Workspace settings and Projects. They created API configuration
and project records through the real forms, opened Planner Agent, selected the
saved destination/model and gave explicit sharing/charge consent.

Both final journeys passed. A lost POST response was retried with an identical
payload and retained request, then the real local worker and SDK made exactly
one model request. The packet SHA-256, configuration hash and original revision
were retained. The proposed progress record was not created automatically.
A separate running request was cancelled by keyboard; its provider response was
aborted and no answer/receipt published. Editing the API through Workspace
settings retained the original revision, and the corrected keyless model ran
without an authorization header. Each journey made three model requests total:
one original completion, one cancelled request, one keyless completion.

Revocation preserved both completed requests and the full retained history.
Original result identity and bytes stayed equal after correction. Anonymous
history returned 401 and authenticated direct credential access returned 403.
The explicit disposable API queue was empty after each journey. These are
synthetic records in the named disposable stack, not agency/client information.
The provider was a local scripted Chat Completions endpoint, with real SDK and
worker processes. No external paid provider was called.

Screenshots were inspected at both widths. Viewport width equalled document
width, including 390px. Retained results, original destination/revision/hash and
proposal review controls fit the panel. Long history scrolls within the existing
Planner Agent conversation. There were no page errors. Each successful final
console contained only the one deliberately aborted POST resource error.
BROWSER_SHA256SUMS covers the public synthetic reports, viewport captures and
identified-build record. It does not turn synthetic output into model quality.

## Errors and limits retained

Initial browser scripts used the edit form's key label for a new connection and
exact label-text selectors for wrapped controls. Inspected screens and accessible
snapshots identified the actual controls; the harness now uses their roles/names.
These were harness errors, not established product defects. A full-panel capture
was clipped by the fixed overlay; final evidence uses viewport screenshots.
One final mobile attempt encountered Chrome ERR_NETWORK_CHANGED while reloading
Workspace settings. That failure and screenshot remain private under
api-ui-5b84838c-network-change. The final replay uses the existing Refresh
connections control before revocation and passed. No network error is erased
from the failed run or claimed as a successful journey.

The UI has 25 focused cases; the existing panel has 28. The restored UI/route
replay passed 79, and the subsequent settings/documentation replay passed 100
cases in five files. TypeScript and changed-file lint passed before the copy-only
workflow wording update. UI mutations had one harmless survivor and 22 targeted
failures. Request-route mutations had one harmless survivor and twelve targeted
failures. Their sources were restored. Mocked UI/route tests protect different
boundaries than live RLS and actual worker process tests.

Live provider availability, billing and answer usefulness are unmeasured. This
option supports OpenAI-compatible Chat Completions with the required structured
output capability, not arbitrary provider protocols. Broader chat remains
Anthropic-specific; additional OpenCode provider/account modes, broader grounded
tasks, persistent assignments and external MCP remain open. Full v1 planning and
separate AequilibraE/ActivitySim validation obligations remain unchanged.
The successful worker foundation CI/RLS at 47c4985e is prior evidence, not the
final capability release gate. Full candidate QA/shuffle/RLS and an upgrade from
v0.54.0, final main CI and publication are still pending.


## Final wording replay

Source b86f5f878b8ea58d1f83d30c6a4ecf5f65bd9d0c clarifies Saved API and the
exact name/summary/status/question disclosure and consent. The unchanged copy
guard caught the earlier regression; no baseline was increased. The restored
copy and both panel suites passed 57 tests. A harmless comment passed the four
copy checks. This guard cannot judge meaning or layout, or detect all dynamic
strings. Existing route/UI mutation results remain applicable; no guard changed.

The complete workflow above ran again on this identified source at 1440px and
390px, including actual worker execution, interrupted retry, cancellation,
correction, revocation and private access checks. Each final run had three model
calls, no page errors, no horizontal overflow, and only the deliberate aborted
POST console error. Consent, results and corrected history screenshots were
inspected at both widths. [Replay artifacts](wording-replay/) and their
[checksums](wording-replay/SHA256SUMS) retain the evidence; previous evidence stays
unchanged. The first desktop attempt hit Chrome ERR_NETWORK_CHANGED before
saving configuration and timed out. Its screenshot/log remain private under
api-ui-b86f5f87-network-change; no product cause is established. A replay after
the shuffled suite finished passed without changing the browser script.

The initial dev launch failed because Next inherited Node's --env-file flag in
NODE_OPTIONS. Loading the private environment in a parent launcher fixed startup;
no application fix was needed. The owned dev server was stopped after collection.

Shuffled seed 912556 passed 14080 tests, 450 skipped, across 1258 passing files.
Full isolated RLS completed 479 tests in 50 files. Nine database function-source
hashes match the retained worker reference; active API queue was zero. Upgrade
Path 34730331136 succeeded from v0.54.0 on 8b4f756c. Subsequent changes are
wording/docs only; no SQL/worker/upgrade change invalidates that result. Full QA
replay and final main CI remain pending. Skipped unit categories are not inferred
passed; RLS and worker evidence cover their stated independent boundaries.


## Completed local release checks

Full QA on 886ce2dc finished exit 0: 14080 application tests and 382 native
connector checks passed; 450 application tests and four native checks were
explicitly skipped. Lint, the existing advisory dead-code command, dependency
audit with zero vulnerabilities, TypeScript and webpack production build passed.
This supersedes the pending full-QA entries above. Shuffled 912556 and all 479
isolated RLS tests passed independently. [Machine-readable local results and log
hashes](local-release-checks.json) preserve source and command identity.
No Python runtime changed; final GitHub CI includes its configured Python worker,
modeling and ops checks. Full local Python/scientific validation is not inferred
from those configured jobs.

Only documentation and retained evidence follow this QA source. Main must pass
its exact CI and RLS workflows before the v0.55.0 tag. The GitHub release records
those run links and publication; earlier main 47c4985e is not substituted for
release-commit evidence. The upgrade source predates only wording/documentation,
with migration, worker and API implementation unchanged.

## Published release

[v0.55.0](https://github.com/nfredmond/openplan/releases/tag/v0.55.0) was published
on September 12, 2026 at 19:01 Pacific, 2026-09-13T02:01:15Z. It is neither a
draft nor prerelease. The annotated remote tag peels to
c73b051095d59beb105cf9cb1570776d416676ec, the exact main commit whose
[all five CI jobs](https://github.com/nfredmond/openplan/actions/runs/34731133158)
and [RLS](https://github.com/nfredmond/openplan/actions/runs/34731133153) passed.
The local release checks and unchanged-upgrade evidence are above. JSON CI/RLS
and publication receipts are retained here. Subsequent M9b response-recovery
work is separate and is not included in this release.
