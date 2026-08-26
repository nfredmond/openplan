# OpenPlan full review and v1 roadmap, 2026-08-25

> **Correction added 2026-08-25 after source verification:** this report's
> 43.3% figure is the metric from the roughly 30% model-selection holdout drawn
> from a 57-station, one-county dataset, not independent nationwide accuracy
> evidence. The national error remains unknown.
> Nathaniel also expanded the v1 contract after comparing this report with the
> Codex review. The current decision is recorded in
> `docs/reviews/product-direction/2026-08-25-v1-direction.md`; the original
> analysis below remains unchanged as comparison evidence.

Reviewed at `391eed25` (v0.34.0), clean synced `main`. This covers the whole
repository, the 2,412-commit history, all 34 releases, every agent memory and
plan file, the Claude and Codex session records, and the documentation set. It
is the reasoning behind the roadmap rewrite in `docs/ROADMAP.md`.

---

## 1. The one thing worth reading if you read nothing else

**OpenPlan has outstanding process discipline and no product destination.**

Thirty-four releases in six months, each one a sensible answer to "what's
next," and the roadmap document was a rolling record of the last three of them.
Nowhere in the repository was there a written answer to the question *what has
to be true before this is version 1*. The only 1.0 definition anywhere was a
release-engineering checklist. Restore drill, upgrade rehearsal, RLS, CI. All
of that tells you whether a release is safe to ship. None of it tells you
whether the product is finished.

That is why every session starts by re-deriving priorities, and why "what's
next" is the most common thing you type. The roadmap now states a destination.
Everything below is either evidence for that claim or the work that follows
from it.

---

## 2. Where OpenPlan actually is

All measured at `391eed25`, not recalled.

| | |
|---|---|
| Commits | 2,412 since 2026-02-19 |
| Releases | 34 minor versions, v0.1.0 through v0.34.0 |
| Planner-facing pages | 60, across 19 navigable surfaces in 8 menu groups |
| API routes | 256, **zero of them without a caller** |
| Database migrations | 223 |
| Unit tests | about 12,400 across 1,111 files |
| Python workers | 5 (AequilibraE, ActivitySim, county on-ramp, OCR, drone), 42 test suites |
| Assistant write actions | 12 registered, 14 executable refusal families covering 60 refused capabilities |
| CI at HEAD | green. CI, RLS Isolation, restore drill, upgrade path |

The pace deserves a note. Nineteen of those releases landed in the 31 funded
days from 15 July to 15 August, and fourteen more in the ten days after. That
was a paid pace with heavy multi-agent workflows behind it. It is not the
baseline for anything planned from here.

---

## 3. What is genuinely excellent

**The honesty machinery is the real competitive advantage.** Claim tiers,
refusals written as executable tests, mutation proof as the standard of
evidence, pre-registered sealed studies, negative results kept rather than
buried. A federal grant reviewer or an agency's counsel cares about exactly
this, and almost no commercial planning software can show it. When the 2017
NHTS study died mid-run, it was recorded as permanently inconclusive instead of
being retried. That decision cost real work and it was the right one.

**Breadth that actually connects.** RTP, land use plans, programming cycles,
grants, invoicing, safety, public engagement, aerial imagery, travel modeling,
reports, documents. Not sixteen half-modules sitting next to each other. A
project carries a corridor into safety, into a report, into a grant.

**Operational maturity beyond the product's age.** A backup and restore drill
that runs on free infrastructure and actually passed. Upgrade-path CI. Worker
heartbeats with honest capability states. An RLS census that catches
join-scoped tables.

**The security review closed completely.** The 26-finding review of 2026-08-16
found two criticals on the grant appendix, three tenancy holes, and two
documented install paths that amounted to remote code execution. All worked. I
verified the county worker fix in the code rather than trusting the checklist.

---

## 4. The seven honest weaknesses, ranked by what they cost a real user

### W1. Outside California, the Safety module counts only deaths

`openplan/src/lib/safety/sources/registry.ts` registers two crash sources.
CCRS separates fatal from injury crashes inside California. FARS is the
national fatality-only backstop. There is no serious-injury source for any
other state.

So in Oregon or Texas, OpenPlan ranks "KSI locations", meaning killed and
seriously injured, from fatalities alone. SS4A and HSIP, the two programs this
module exists to feed, both score on KSI. The number is missing half its
definition in 49 states, and the ranked-locations panel does not say so where a
planner reads the ranking.

This is the sharpest live conflict with product non-negotiable #1. It is now
v0.35.

### W2. The model over-assigns, cannot see most roads, and does not say which

The measured position, from `docs/modeling/WHERE_THE_NUMBER_STANDS_2026-08-20.md`:

- The screening model puts roughly **1.7 times too much traffic** on counted
  roads.
- About 1.10 times of that is concentration, meaning displaced travel piling
  onto the road classes where count stations sit.
- **Roughly 1.6 times has no identified cause** after seven separate measured
  investigations ruled out zone size, tertiary under-assignment, missing local
  travel, and count-seeding.
- **77 to 85% of road links inside a study area carry no assigned traffic at
  all**, including 96 to 100% of residential and local streets, because a
  centroid connector loads a path rather than an area.
- Held-out median error after calibration is 43.3% against a 30% gate.

None of that is a bug. It is the resolution of a screening model, and it has
been measured honestly, which is more than most tools in this space can say.
**The defect is that a road the model over-assigns and a road the model cannot
see look identical on screen.** A planner reading a corridor volume is not told
which of the two they are looking at.

The fix at v1 is disclosure, not calibration. Chasing that 1.6 times has
already eaten weeks and belongs in a post-1.0 research lane.

### W3. Work goes in more easily than it comes out

OpenPlan reads CSV, XLS, XLSX, ODS, GTFS, GeoJSON, shapefiles, and drone
imagery. It writes CSV, GeoJSON, and PDF. The v0.33 and v0.34 workbook importer
is excellent. The outbound path has not moved.

Agencies live in ArcGIS and QGIS. A corridor analysis a planner cannot open in
their own GIS with its provenance attached is one they will not stake a grant
application on. This is v0.36.

### W4. There is no answer to "who is allowed to approve this"

`WORKSPACE_ACTION_ROLE_MATRIX` covers 23 actions across eight modules.
Everything else, meaning safety, grants, projects, RTP, land-use plans, aerial,
documents, measures, and the data hub, authorizes writes by bare workspace
membership plus a blanket read-only viewer gate.

For one planner working alone this is invisible. For the actual customer, an
agency where an analyst drafts and a director signs, it means OpenPlan cannot
answer who may adopt a plan, obligate money, or publish to residents. The
consequential actions already exist and are already human-only. What is missing
is *which* human. This is v0.37, and it absorbs the half-built My Work inbox.

### W5. Jurisdiction coverage is thinner than the architecture implies

The registry architecture is right. Adding a jurisdiction means adding a
descriptor, not editing call sites. What is actually registered:

| Registry | Coverage |
|---|---|
| Grant programs | Federal plus CA, CO, OH, OR, TX, WA |
| Stage-gate templates | US federal floor, California, LAPM invoicing |
| Land-use legal bundles | **California only** |
| Crash sources | California at all severities, national fatal only |
| Traffic counts | **Nationwide**, HPMS with registered state publishers |
| Equity designations | National, CEJST v1.0, bundled because the federal host is dead |

Degradation is honest everywhere I checked. An Oregon workspace says no Oregon
pack is registered rather than pretending. That is the right behavior. But
honest and empty is not yet a product for an Oregon planner. Adding bundles is
data work that should follow a real user rather than get ahead of one, so it is
not a 1.0 blocker.

### W6. Nobody outside you has ever installed it

Self-service is non-negotiable #4. The install path has been verified by agents
driving browsers and by a fresh-clone walkthrough. It has never been done by a
stranger. That is the last item before 1.0 and the one that cannot be faked.

### W7. Documentation and memory build-up

209 dated evidence records across two `docs/ops` directories, 115 agent
memories, 35 plan files, two 31 KB instruction files. Every model generation
pays for this on every session. Addressed below.

---

## 5. What v1.0 should mean

My proposal, now written into `docs/ROADMAP.md`:

> **An agency anywhere in the United States can install OpenPlan, carry a real
> piece of statutory planning work end to end, and defend every number in it.**

Three clauses, each with a test that can fail:

1. **Anywhere in the United States.** No module is silently California-only.
   Every module either has national data or states its exact coverage limit
   where the number is read, on the map, in the panel, in the export, rather
   than in a caveat paragraph a reader may never reach.
2. **A real piece of work, end to end.** All seven first-week journeys complete
   from a fresh account, driven by an agent with no product knowledge, using
   only visible navigation, each ending in an artifact you could hand a board.
3. **Defend every number.** Every figure in an export traces to a named source
   with a claim tier, and a figure whose evidence is unavailable is withheld
   rather than estimated.

Plus the release-engineering gate that already exists and is already nearly
met.

**What v1.0 does not mean:** that the travel model reproduces observed counts,
that every state's law is configured, or that agentic control exists. Writing
that down is the whole point. Those three keep getting re-litigated at every
checkpoint, and each time it costs a session.

---

## 6. The roadmap

Four releases, each a named user outcome, sized in lanes that finish, because
sessions are scarce now.

### v0.35, serious injuries outside California

Extend the crash-source adapter tier so a state DOT feed registers the way the
WA, CO, and OR count publishers already do. Research which state crash APIs are
open and keyless, then register the ones that are. Do not guess the list. The
CCRS record shows how fast these die. Where nothing is registered, state the
severity ceiling on the safety map and in the ranked-locations panel, before
the ranking, in plain words. Carry the ceiling into the packet, the grant
evidence, and the export.

*Done when:* a fresh workspace in an unregistered state ranks locations only
after saying what it cannot see, and removing that disclosure fails a test.

### v0.36, get the work back out

GeoPackage export for the geographic outputs: study areas, corridors, crash
points, modeled links with volumes, engagement pins, land-use designations. One
format, because GeoPackage opens in both ArcGIS and QGIS. XLSX export mirroring
the workbook import so a portfolio round-trips. A per-project evidence bundle
whose manifest carries source, retrieval date, claim tier, and known limits for
every figure. Provenance travels in the attribute table, not a sidecar readme.

*Done when:* a planner exports a corridor, opens it in QGIS, and reads the
source and claim tier of every attribute without opening OpenPlan.

### v0.37, one agency, many people

Extend the role matrix to every module that writes. A new module without a
matrix entry should be a build error, the way a new role already is. Add named
approval to the consequential actions that already exist: plan adoption,
stage-gate decisions, publishing to residents, obligating funds, releasing an
RTP for review, recorded beside the existing exact-hash records. Make My Work
the approval inbox. The review queue landed already. Approvals are the missing
half.

*Done when:* a `member` cannot adopt a plan, a `viewer` cannot reach the
control, and the adoption record names the approver.

### v0.38, the model says what it knows, where it is read

Presentation, not calibration. Per-link coverage state on the corridor map and
in every artifact that quotes a volume: modeled, unloaded, or outside the
network. An unloaded link never renders a number. The over-assignment bracket
travels with the volume instead of living in a caveat block. Promote
with-project versus without-project framing over absolute volumes, because that
is the comparison the model is actually good at and the one a corridor decision
needs.

Plus **Engagement by Safety**, clustering resident map comments against crash
locations. It is item 2 of your endorsed backlog, it touches no model volumes
so nothing above blocks it, and it is near-ready SS4A evidence.

*Done when:* no surface can display a modeled volume without its coverage
state, and dropping the coverage state fails a test.

### v1.0, the stranger test

The full release gate against one candidate commit. All seven first-week
journeys with zero blocked or failed jobs. **One person who is not you installs
from the README on a clean machine and completes the project journey without
help.** Documentation consolidated. No open Blocker or High in the quality
register whose boundary is not disclosed inside the product.

### Deliberately excluded from 1.0

Chasing the 1.6 times. Averaging the two models, which is permanently rejected.
Crash rates per modeled VMT, blocked on a defensible denominator. MCP and Buzz,
where ADR-004 stands and where **you asked to be reminded that you still want
this, so: you still want this, and the action registry is what keeps it cheap**.
New modules.

---

## 7. Cleanup performed

### Roadmap and docs, committed as `0c06007e`

- `docs/ROADMAP.md` rewritten around the v1.0 definition above. The active
  roadmap guard passes. I confirmed it could fail first, by giving it a path
  that did not exist and watching it reject the file.
- `docs/README.md` gains a "what is being built" section pointing at the
  roadmap and the quality register.
- Both `docs/ops` directories gain a period index. `openplan/docs/ops/` had no
  README at all. It now separates the two current operating documents from the
  105 dated evidence records.

**The dated evidence files were deliberately not moved into `archive/`
subdirectories.** Several are cited by path from shipped code and from
`COMMENT ON POLICY` statements inside applied migrations. A migration is
history. Rewriting one to chase a moved file would falsify a shipped record,
and leaving the citation dangling would be worse. The index is the navigation
instead.

### CLAUDE.md and AGENTS.md, corrected in place

Both files are gitignored, so these edits have no git safety net. I backed both
up before editing.

Three stale entries, one of them actively harmful:

1. **"The gateway defect BLOCKS it."** The dual-model section still listed the
   gateway placement bug as a blocking prerequisite. It was fixed on
   2026-08-15, and I verified the fix in
   `scripts/modeling/screening_runtime.py`. An agent reading that line would
   have refused to start a lane that already shipped through to Reports and
   Grants. Now marked closed, with a note not to cite it again.
2. **"12 registered actions, 11 recorded refusals."** The action count is still
   right. The refusal count is not. Now 12 actions and 14 refusal families
   covering 60 capabilities, with the two shell commands that give the current
   answer, so the line stops being the authority.
3. **The nationwide-calibration section** was pinned to a model-access date in
   the past. Rewritten as a standing ask for whichever model is strongest, with
   the scalar-fitting trap intact.

Both files also gained a short v1.0 section at the top pointing at the roadmap.

### Agent memory, 50 of 115 archived

Moved to `memory/archive/`. Nothing deleted. What went: shipped-release records
such as the stage and wave logs and the per-version four-lane notes, completed
audit scorecards, the conference and outreach memories that conflict with
non-negotiable #3, and the sixteen-file modeling-forensics chain whose detail
now lives properly in `docs/modeling/`. The index dropped from 24 KB to 7 KB
and is grouped by purpose rather than by date, so the next session reads a map
instead of a stack.

### Plan files, 29 of 34 archived

Kept: the UX feedback log, which is living, the dual-model directive, the
vitest isolation handoff, the CLAUDE.md archive, and the 2026-08-16 review
findings. The rest were per-session handoffs long since executed.

---

## 8. Where I might be wrong, and what would settle it

Stated plainly, because you cannot check these yourself.

- **The crash-data gap is the biggest thing I found, and I have not confirmed
  that open serious-injury APIs exist for other states.** I confirmed the gap
  in OpenPlan's registry, not the availability of a fix. If most states publish
  no open injury feed, v0.35 shrinks to disclosure work and the ranking has to
  be reframed as fatal-only outside California. **That research is the first
  task of the release, not an assumption behind it.**
- **I did not run the full test suite or open the browser.** CI at HEAD is
  green and I trusted it. Everything I claim about the code, I read. Everything
  I claim about behavior comes from CI, from a focused test I ran myself, or
  from the recorded first-week evidence.
- **"19 navigable surfaces" counts nav registry entries, not finished
  features.** Several, including transit, Title VI, and benefit-cost, are
  reachable only through panels inside other pages. They are wired, not
  prominent. Whether that is correct is a product call, not an engineering one.
- **The four-release order is my judgment, not a measured result.** I put crash
  data first because it is the clearest broken promise, and export second
  because it is what makes everything else usable outside OpenPlan. If you
  would rather do export first, nothing breaks.

---

## 9. One process note you should know about

You started a Codex session on this same prompt in this same working directory
while I was working. Two agents editing one tree is the failure mode your own
instructions warn about, and `CLAUDE.md` and `AGENTS.md` are gitignored, so
whichever of us wrote last would silently win with no history behind it.

What I did about it: committed and pushed the repository changes promptly so a
collision shows up as a git conflict rather than a lost update, backed up both
gitignored instruction files before touching them, and kept the destructive
part of the cleanup inside `~/.claude/`, which Codex does not write to. If the
two reports disagree about the state of the tree, check `git log`. Mine is
`0c06007e`.

---

## 10. What I need from you

Three product questions. Everything else I decided.

1. **Is "honest screening model" the v1 story?** The model will not reproduce
   traffic counts by 1.0 and I am not proposing that it should. That makes the
   sentence "a defensible screening estimate with its limits attached" rather
   than "a validated travel demand model." I think that is a stronger position
   than most vendors can hold, and more honest. But it is your call and it
   shapes copy across the whole app.
2. **Which states matter most after California?** For crash data, grant
   programs, and legal bundles. Registering three states you would actually
   walk an agency through beats registering ten picked off a list.
3. **Is the four-release order right?** Crash data, export, permissions, model
   disclosure. Any of them can move.
