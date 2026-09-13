# Saved API project workflow, v0.55.0 candidate

The accepted workflow source is 5b84838c86852a228e23ea1a138551581b9132fd.
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
