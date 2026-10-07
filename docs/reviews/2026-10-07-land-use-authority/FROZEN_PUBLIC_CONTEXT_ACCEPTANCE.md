# Frozen history and public context acceptance

October 7, 2026. This bounded M1 check uses existing synthetic records on the
isolated stack. It makes no new adoption or publication decision.

## Findings and correction

At `68cbd469be2daff022bfc05b6319489894d0ea38`, staff opens version 1 from the
history of a plan whose latest edition is version 2. The historical workbench
retains version 1 context, content and review link. Write controls stay disabled.
Both native snapshots remain unchanged after the browser reads.

The list incorrectly says "Version unavailable" when neither current pointer
exists. The public review page also omits retained plan context even though its
JSON contains that context. Commit `ce10cfb896ceb8ec1f1f7a2f2ec17fe620f13593`
uses the latest edition as the final list fallback, renders retained context on
both public pages, and gives the JSON links explicit download filenames.

## T3 journey and artifacts

T3 navigates from the workspace list to the plan, historical version 1 and its
public review. The corrected list shows "Version 2 · public review". The public
page shows the saved area, adopting body, unresolved applicability explanation
and legal caveat. The [desktop](frozen-public-context/publicContextDesktop.png)
and [390px view](frozen-public-context/publicContextMobile.png) retain that text.
The mobile context right edge is 355.2 CSS pixels within the 390px viewport.

A separate existing adopted legacy fixture opens through the workspace picker,
plan list and published-plan link. Its [desktop](frozen-public-context/publicAdoptedDesktop.png)
and [390px view](frozen-public-context/publicAdoptedMobile.png) disclose that this
edition did not retain context. No actual vote occurred. This case does not prove
an adopted edition with populated context in the browser; mounted tests cover it.

Keyboard activation saves review and adopted JSON files of 5,501 and 1,865 bytes.
The [download check](frozen-public-context/download-verification.json) compares
both against native frozen snapshots and anonymous HTTP responses, then
recomputes their canonical content hashes. Reordering object keys passes;
changing the frozen title fails. The review hash is
`971d2c823e79849661b6563845386d3d701f2f2d412282360e43fbe36d7dc836`.
The legacy adopted hash is
`629c4851c7fa534dd133e1a6b9dd49f77971101add5b1151054fd1e09fd98b56`.
The committed report contains file hashes, not private browser journals.

T3 intercepts target-blank links into the same preview tab. This journey therefore
does not prove native new-tab preservation. The fixtures have no map features;
this does not establish mapped-content acceptance.

The [console record](frozen-public-context/console-review.json) contains two
Electron preview startup errors and a health fetch attempted from the browser's
error page while the new server was starting. A retry against the same ready
server succeeds. No additional application console error appears in the retained
record. Older network and action entries are omitted, so this is not a complete
network audit. The earlier copy note's two omitted console entries are now
identified as those Electron startup errors.

## Checks and remaining work

[Seventy-four tests in five suites](frozen-public-context/focused.log), TypeScript,
changed-file ESLint and the [production build](frozen-public-context/build-status.json)
pass. Thirteen targeted faults fail for their stated assertions, with baseline
and harmless-comment controls passing and source hashes restored. The
[first control run](frozen-public-context/public-context-controls/report.json)
stops because its failure matcher does not recognize a valid DOM assertion
error. The corrected [control run](frozen-public-context/public-context-controls-v2/report.json)
recognizes that assertion format and completes all cases. No product assertion
is weakened. Mounted mocks do not prove native authorization or browser behavior.

The build runs alone under an 8 GiB ceiling. The identified server uses the owned
checkout on port 3498, peaks at 321,839,104 bytes, and stops normally. The
[server record](frozen-public-context/server-status.json) confirms the process
cwd and cleared port. The old BCA service remains stopped after its separate
October 6 OOM at a 5 GiB ceiling. Its partial output is not a passing test run.

Public content acceptance remains incomplete. Both public pages omit policies
outside sections, and the review page omits implementation actions. The legacy
context panel also introduces saved context before disclosing its absence.
These are follow-up defects, not accepted release behavior. Remaining geography,
practitioner, counsel, scientific and full V1 acceptance remain open. No release
or merge is declared by this record.

Artifact integrity is recorded in [sha256.json](frozen-public-context/sha256.json).

The [public content follow-up](PUBLIC_CONTENT_FOLLOWUP.md) corrects the root-policy, implementation-action and legacy-introduction defects identified here. Its acceptance limits remain separate.
