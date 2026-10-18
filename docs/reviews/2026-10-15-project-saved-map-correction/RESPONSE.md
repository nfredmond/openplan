# Saved-map camera correction

October 15, 2026. This responds to the accepted P2 in the unchanged
[independent report](INDEPENDENT_REVIEW.md), committed as
`17a25d077482dc5b12a9753402fe0a9edc50517e`. The review remains independent and
unchanged. This response does not replace its findings or grant acceptance.

## Implementation and scope

The saved-map renderer now produces a geometry-aware camera instruction.
Each connected polygon, including its rings, and each connected line retains
its full ordinary longitude span. MultiPolygon parts remain separate spans.
The helper merges overlapping spans and removes only the largest unoccupied
circular gap. A tie preserves ordinary framing. A split date-line area therefore
uses camera corners near 180 degrees rather than a 360-degree frame. Broad and
full-world areas retain their occupied coverage, including when nested parts or
other saved features are present. A single zero coordinate remains a point fit.

This is a camera calculation. It does not rewrite collection coordinates,
rings, holes, saved records or export bytes. Export eligibility, the ordered
WGS84 extent validator and all existing camera options remain unchanged. The
helper accepts the renderer's existing validated Point, LineString, Polygon and
MultiPolygon inventory. It does not add topology validation or infer legal
jurisdiction. Unsplit edges retain their Cartesian span; an intended compact
crossing should use antimeridian-cut components.

The existing `longitudeExtent` in `geo/crs/reproject.ts` minimizes vertex angles.
It cannot preserve broad occupied polygon interiors without additional component
information. The adjacent helper keeps that geometry information and returns the
existing `FitInstruction` type, applied by the existing shared camera function.
No new module or API is introduced.

Primary documentation supports these boundaries:

- [Mapbox fitBounds](https://docs.mapbox.com/mapbox-gl-js/example/fitbounds/)
  permits camera longitudes outside the usual range.
- [GeoJSON RFC 7946 sections 3.1.1 and 3.1.9](https://datatracker.ietf.org/doc/html/rfc7946)
  define Cartesian line segments and antimeridian cutting. Geometry remains
  supplied record data; this correction does not reinterpret broad polygon edges.

## Retained history and controller correction

`history/` preserves the original read-only implementation proof, except its
checkout-specific temporary TypeScript configuration. Its controller, all three
campaign summaries and individual results/logs remain unchanged. The earlier
style-recovery survivor and before-visible-framing records keep their original
source bindings. The original 19 final faults remain behavioral evidence
reviewed by the independent reviewer. Their old classifier does not become an
exact-diagnostic guard through this correction.

`verify_controls.py` and `faults.json` provide a separate portable campaign.
A fault must fail exactly the declared full test names with exactly the declared
first-line assertion diagnostics. The controller rejects unrelated assertions,
runtime errors, unhandled errors, import/compiler failures, wrong exits and
inconsistent counts. Repeated parameter cases require the entire expected set.
Missing test selection cannot qualify. Stack paths remain outside diagnostic
matching because each checkout has a different absolute path.

The campaign runs its own classifier fixtures, a harmless classifier edit and
faulty classifier controls before the application campaign. Source writes occur
only in this assigned tree and restore exact captured bytes in `finally`.
The inherited panel faults temporarily alter the existing inventory caller;
there is no permanent panel edit. No Git reset or checkout restores source.

## Verification and retained failures

The final [controls](controls.json) record 33 passing cases in each baseline,
harmless-comment and restored cohort. All 28 declared behavior faults fail their
named assertions: the inherited 19 plus nine framing/parity faults. Nine faulty
classifier controls fail their named classifier assertions. Fourteen classifier
fixtures include the accepted intended failure and rejection of unrelated
assertions, runtime/import/compiler errors and inconsistent results. The
harmless classifier edit survives. Source restoration and every final binding
match. The scope limits memory to 1 GiB, additional swap to zero and CPU to one
core. Recorded campaign peak is 284,348,416 bytes with zero swap and zero OOM
or kill events.

The final regression passes 157 cases across eight scoped files. It includes the
original five-file regression, the adjacent helper, shared camera and strict
ordered-WGS84 bounds tests. Focused TypeScript and strict ESLint pass. These are
source and simulated lifecycle checks, not a production build or browser result.
[Check summary](checks.json) records files, commands and source hashes.

The four unsuccessful correction trials remain separate:

- `trial-01.json` stops at a mismatched expected map-object diagnostic.
- `trial-02.json` rejects four formatting mismatches, including the explicit
  assertion labels and the actual mock name. The controller does not count them.
- `trial-03.json` rejects six new selectors that match no tests. Vitest quotes
  table-case names; the corrected selectors include those quotes.
- `trial-04.json` rejects two exact formatting expectations for narrow bounds
  and the zero point. The failures are the intended camera assertions; their
  inspected diagnostics now appear explicitly in the manifest.

Every trial records exact source restoration. No expectation is replaced with a
nonempty-message or nonzero-exit shortcut. The final campaign reruns every fault
against the corrected source and manifest. The original failed campaigns in
`history/` retain their separate original bindings and interpretation.

To rerun from this checkout with its locked npm dependencies installed:

```bash
systemd-run --user --scope --quiet \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 -B docs/reviews/2026-10-15-project-saved-map-correction/verify_controls.py \
  --output /tmp/openplan-saved-map-controls-UNIQUE
```

The output directory must be new. The controller derives the repository root
from its own path; it has no dependency on another worktree. Its Vitest processes
use one worker, no file parallelism, no cache and a 640 MiB Node heap. The supplied
scoped TypeScript configuration also uses checkout-relative paths.

## Provenance and acceptance limits

Assigned tree: `/home/nathaniel/.t3/worktrees/openplan/t3-1ff437d5`.
Assigned branch: `t3/saved-map-dateline-wrapped-framing`.
Initial clean head: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
Fetched origin; clean fast-forward through observed current main
`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, then exact feature candidate
`92eaacf51bd111d3de37cf72943301aba0f7acde`. No drift at that update.
No merge into main occurs.

Read current AGENTS, shared state-folder coordination and restart continuation,
binding contract, roadmap, ledger, direction review and relevant architecture,
capability and known-issue sections. Nested product direction passes with the
existing review-age/version reminders. Applied planner-writing, prove-it,
any-place and Mapbox geometry/integration guidance. The look skill's browser
boundary remains deferred by the explicit parent-owned acceptance assignment.
Model readback is `gpt-6.1-sol`, high reasoning. No other model or child is used.

Owned permanent changes are the renderer, adjacent helper, focused saved-map and
camera tests, and this evidence directory. The saved-map panel restores exactly.
Jurisdiction/identity/PATCH/readiness/reports, migrations, other map/editor paths,
shared coordination and continuation remain unchanged. The original map tree
is clean and its [history bindings](history-bindings.json) match all 49 retained
files. The independent report is byte-identical to its exact Git object.
`probe.mjs` and `probe-result.json` preserve the original diagnostic unchanged;
they describe the reviewed candidate, not this correction's execution.

T3 taskId:
`node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-project-map-dateline-correction-20261015-round1`.
Parent thread: `1401bb6a-70e4-42eb-a1f1-98045485f8cc`.
T3-owned completion returns this checkpoint to the parent.

Parent still owns integration, independent exact-head follow-up, expensive checks,
and identified-build desktop and exact 390px browser journeys. No full build,
QA gate, application service, live database, migration application, database
reset, process killing, hosted action, paid infrastructure, PR, push, merge or
branch deletion occurs. The bounded transient execution scopes end with their
commands; they do not start an application service.

These checks cannot establish WebGL projection or tessellation, visible holes,
style/tile availability, actual container sizing, control/attribution visibility,
keyboard/screen-reader access, desktop/390px legibility, native downloaded export
byte parity, independent practitioner usefulness, topology, survey/legal validity,
scientific accuracy or whole-product acceptance. The independent report's other
unproved boundaries remain open. No release or capability grade changes.
