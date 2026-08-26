# The first-week harness

Twenty releases of OpenPlan shipped with nobody but agents looking at it. Then
Nathaniel used it himself for twenty minutes and produced a better defect list
than eleven thousand tests had.

That is not a failure of the tests. A test asks *does this do what I decided it
should do*. A new person asks *what am I supposed to do here*, gets no answer,
and leaves. Nothing in this repository could ask the second question, so
Nathaniel was the only instrument that could — and he does not scale.

This harness is a second instrument. It has two layers, and the split between
them is the whole design.

| | Discovery | Regression |
|---|---|---|
| What it does | Hands a **fresh agent** a planner's job and a browser, and records where it got stuck | Re-runs one confirmed dead end as a fixed script |
| Finds | Things nobody thought of | Only things somebody already thought of |
| Deterministic | No — that is the point | Yes |
| Cost | One agent session per job — measured at 16–22 min and ~135 steps each | Seconds |
| Is it a gate? | Findings do not gate; selected journey outcomes do | Yes, it can be |

Discovery finds it once. Regression keeps it fixed. Discovery also has an
outcome gate: every selected journey must finish and report `outcomeReached:
"yes"`. A finished agent session with `"partly"` or `"no"` fails that gate.

---

## Before you run anything

You need a local OpenPlan on a loopback address, and an account on it.

```bash
cd openplan
npm run dev -- -p 3200
# confirm it is THIS checkout, not one of the others on this machine:
ls -l /proc/$(ss -ltnp | grep ':3200 ' | grep -o 'pid=[0-9]*' | cut -d= -f2)/cwd
```

Both layers refuse any base URL that is not local, and there is no flag to turn
that off. The discovery agent signs up, types, uploads, publishes and deletes
without supervision; that is an acceptable thing to point at your own machine
and an unacceptable thing to point anywhere else.

---

## The discovery layer

```bash
cd qa-harness
npm install

OPENPLAN_BASE_URL=http://localhost:3200 \
OPENPLAN_FIRST_WEEK_EMAIL=you@example.test \
OPENPLAN_FIRST_WEEK_PASSWORD='…' \
  npm run first-week-discovery                              # all eight jobs

... npm run first-week-discovery -- --job 03-public-engagement
... npm run first-week-discovery -- --list
... npm run first-week-discovery -- --verify-only first-week-runs/<stamp>
```

Optional: `OPENPLAN_FIRST_WEEK_MODEL` (default `sonnet`),
`OPENPLAN_FIRST_WEEK_TIMEOUT_MS` (default 30 minutes per job).

It uses your existing Claude subscription through the `claude` CLI. No API key,
no metered spend.

**It is not free of your weekly limit, though.** Measured on 2026-08-14 with
sonnet: a job runs 16–22 minutes and ~135 steps, and the CLI reports around
$8.50 of API-equivalent usage for one. All nine jobs is more than a working hour
and a real bite out of a week's allowance. Run the whole set when something big
has landed; run one job when you want to check one surface.

### The nine jobs

They live in `first-week-jobs/*.job.md` and they are written as **outcomes, not
clicks** — "produce something you could show a board", never "click Reports then
click New". A job that names a button tests the button. A job that names an
outcome tests whether a person can find the button, which is the thing we cannot
otherwise see.

| Job | The surface it walks into |
|---|---|
| `01-first-day-setup` | First run: sign up from nothing, work out what the software is for |
| `01-neutral-geography-setup` | Set up a workspace where local legal bundles are not configured, without receiving California rules |
| `02-project-end-to-end` | A project from an empty screen to a board-ready handout, with a folder of files from a predecessor |
| `03-public-engagement` | Publish something residents can use, get a comment back, moderate it |
| `04-safety-case` | Find where people are being hurt, and whether the numbers on screen can be trusted |
| `05-analysis-corridor` | Run an analysis, know whether it worked, explain the answer without jargon |
| `06-land-use-plan` | Author, review, adopt, publish, and report a land-use plan through visible entry points |
| `07-project-gis-handoff` | Download one project's standard GIS handoff with its CRS and coverage limits visible |
| `08-project-portfolio-round-trip` | Download the workspace portfolio and bring the same XLSX back through the reviewed create-only importer |

Rewrite them freely. They are prose, and prose is the part a planner can edit.
The `--- header ---` at the top of each carries only `id`, `title`,
`account` (`new` signs up fresh, `existing` uses your credentials), `files`
(`handover` drops a folder of predecessor's files in the agent's working
directory) and `maxTurns`.

`_reporting-contract.md` is appended to every job. It is the same for all of
them and it is where the evidence rules are explained to the agent.

**If a job's section in `summary.md` says it ended `error_max_turns`, it ran out
of steps** — raise `maxTurns` in that job file, or narrow the job. The very
first run of this harness died that way with three screenshots taken and nothing
written down, which is why the contract now tells the agent to write
`findings.json` after its FIRST finding and rewrite it as it goes. A report that
only exists at the end is a report that does not exist.

### Why the agent must know nothing

An agent that has read the codebase cannot get lost where a new hire gets lost.
It knows the route is `/rtp` when nothing on screen says so; it knows the button
is called "Generate packet". It will reach the outcome through knowledge no
planner has, and its report will be about a product nobody else is using.

Three mechanisms keep the child agent ignorant:

1. It works in a fresh run directory **outside the repository**, so no
   `CLAUDE.md` and no project memory are discovered.
2. `--setting-sources ""` — no user, project or local settings load, which is
   what keeps the global `CLAUDE.md` and the memory index out. This was checked
   by probe rather than assumed: the child was asked to list every memory file
   it had, and answered none.
3. `--tools "Read,Write"` — no Bash, no Grep, no Glob. Pointed at the repository
   it still could not read a line of source. What it has is a browser, over MCP,
   and nothing else.

### Evidence, or it does not count

An agent driving a browser will state, with total confidence, that it could not
find the funding tab, when the funding tab was on the page and it simply did not
scroll. So a claim is not a finding. Every finding must arrive with a screenshot
and the page snapshot from the moment it got stuck, and `first-week-evidence.js`
checks each one **before a person reads it**:

1. the screenshot is a real PNG, at least 800px wide;
2. the snapshot is a page tree, not a summary;
3. the snapshot contains the URL the finding is filed against;
4. every `presentText` the agent claims it saw is in the page tree;
5. **every `absentText` the agent says was missing is NOT in the page tree** —
   this is the did-not-scroll rule, and it works because scrolling changes what
   a person sees but never what the snapshot contains;
6. at least three substantial lines of the snapshot appear in what the browser
   itself recorded, in a directory the agent is never told about;
7. the URL is on the instance this run was pointed at — see below.

**Rule 7 is not hypothetical.** On the first real run the dev server died in the
middle of a job. The agent went looking for the software, found a *different*
OpenPlan checkout on another local port, signed in with the same credentials,
did the whole job there and filed two findings. Both were true sentences about a
tree nobody was testing — and it had written campaign and public-comment rows
into that other instance before anyone noticed. The contract now tells the agent
that a dead address is the finding, and the verifier discards anything filed
against another origin. Neither alone is enough: the first is instruction, the
second is the mechanism.

Findings that fail are **discarded and counted, not investigated**. The count
matters: a run where eight of nine findings were discarded is telling you about
the agent, and you should know that before you read the ninth.

`npm run check:first-week-evidence` tests those rules against fabricated reports
with no browser and no server. All eight of its checks were mutation-tested —
each rule was broken in turn and the corresponding check failed.

**What "confirmed" does and does not mean.** It means the finding is
self-supporting: the page really did look like that. Whether that is *wrong* is
judgement, and judgement stays with the reader. It is also a carelessness
defence, not a forgery defence — an agent that set out to deceive could pair a
real page dump with a false narrative and nothing here would notice.

One more gap, seen on the first real run: nothing checks that the screenshot and
the snapshot are of the same moment. A finding arrived citing `f4.png` next to
`f3.snapshot.txt`, and both were real, so it passed. The snapshot still has to
carry the URL the finding is filed against, so the pair cannot be from two
different pages — but they can be from two different visits to one page.

### The outcome gate

Execution and outcome are separate. `completed` means the agent stopped cleanly
and left a report. It does not mean the planner finished the job.

The discovery command and `--verify-only` exit nonzero unless every selected
journey both completed and reported `outcomeReached: "yes"`. `"partly"` and
`"no"` fail. Quota exhaustion, server loss, timeouts, and unfinished reports
are inconclusive and also fail closed. A resumed run keeps reached journeys and
retries failed or inconclusive ones, archiving every prior attempt first.

### Reading a run

```
first-week-runs/<stamp>/
  summary.md                     ← read this
  <job-id>/
    prompt.txt                   exactly what the agent was told
    job.json                     which account and model it used
    verdict.json                 confirmed vs discarded, with reasons
    agent-stdout.json            the session result, incl. cost and turns
    agent/
      findings.json              what the agent claimed
      evidence/*.png             screenshots
      evidence/*.snapshot.txt    page trees
    browser/                     what the browser recorded, for cross-checking
```

Runs are gitignored. They hold screenshots of a live local workspace and they
are evidence for one afternoon, not source.

**Do not watch a run with `pgrep -f first-week-discovery`.** The watching shell's
own command line contains that string, so it matches itself and the loop never
ends — it reported "still running" for sixteen hours after the run had finished
and written its summary. The run prints `N confirmed, M discarded` and the path
to `summary.md` when it is done; wait on that line, or on the summary file
appearing, and never on a `pgrep` whose pattern is in its own argv.

---

## The regression layer

```bash
OPENPLAN_BASE_URL=http://localhost:3200 \
OPENPLAN_FIRST_WEEK_EMAIL=… OPENPLAN_FIRST_WEEK_PASSWORD=… \
  npm run first-week-regression
... npm run first-week-regression -- --only <id>
```

One file per confirmed dead end in `first-week-regressions/*.regression.js`:

```js
module.exports = {
  id: 'short-kebab-id',
  status: 'open',                 // or 'fixed'
  finding: '<run stamp> / <job id> — the confirmed finding, in one line',
  why: 'What a planner could not do, in plain words.',
  expectedFailure: /header still names/,   // required while status is 'open'
  async run({ page, baseUrl, expect }) {
    await page.goto(`${baseUrl}/somewhere`, { waitUntil: 'domcontentloaded' });
    expect(await page.getByRole('link', { name: /…/i }).count() > 0, 'why it matters');
  },
};
```

### `status`, and why it gates in both directions

Discovery confirms dead ends faster than anybody fixes them, and whoever
confirms one is often not the person who may touch that code. So a script can be
written before the fix exists:

| `status` | The script | A failure means | A pass means |
|---|---|---|---|
| `'fixed'` | asserts the good behaviour | **it came back** — run fails | still fixed |
| `'open'` | asserts the behaviour a planner needs | still broken, as reported | **somebody fixed it and did not record it** — run fails |

`'open'` is not a snooze button. It shouts on every run, and it stops only when
the behaviour changes — in either direction.

An `'open'` script is expected to fail, so a failure proves nothing by itself: a
broken selector, a missing fixture and a timeout all fail too, and all three
would read as "still broken, as reported". That is what `expectedFailure` is
for. The failure message must match the pattern; a failure that does not is
reported as **the script itself being broken**, which is a different and more
urgent problem.

Two more rules:

- **A regression must name its origin.** The `finding` field is required and the
  loader throws without it. A regression with no origin is somebody's guess
  about what might break, and guesses belong in the unit tests.
- **Assert on what a planner can reach** — `getByRole`, visible text — not on
  markup. A regression that fails every time somebody changes a colour gets
  deleted within a month, and then the dead end comes back.

Failures write a full-page screenshot to
`first-week-runs/regression-failures/<id>.png`.

---

## The loop this is meant to close

1. Run discovery. It takes an hour and produces `summary.md`.
2. Read the evidence-complete claims and compare each one with its snapshot. Decide which are real — that part is yours.
3. Fix them.
4. Write a regression for each one you fixed, naming the run it came from.
5. Run the regression layer whenever you like; it is cheap.
6. Next month, run discovery again with the jobs rewritten to reflect what
   planners are actually doing now.

Step 6 is the one that gets skipped. The jobs are the harness's real content:
when they stop describing work a planner recognises, the harness stops finding
anything, and a green run starts meaning nothing at all.

---

## Known limits, stated so a clean run is not over-read

- **It never tests a shapefile.** The handover folder is GeoJSON and CSV because
  those are what the product's upload controls accept. A planner with a `.shp`
  from a consultant is a real and untested case.
- **The GIS handoff journey cannot open QGIS.** It proves a planner can reach and
  download the artifact and read its stated coverage. The deterministic check
  must independently open the file with a GeoPackage implementation.
- **The portfolio round-trip is intentionally create-only.** The journey stops
  after review and does not duplicate the current workspace's projects. A
  workspace over 2,000 projects, or one with a cost estimate missing its price
  year, receives an explicit refusal rather than a partial or invented export.
- **Sonnet by default.** A weaker model reports more noise and a stronger one
  costs more usage. The discard count in each summary is the honest read on
  which way to move.
- **Non-deterministic by design.** Two runs of the same job take different
  routes. Do not diff two runs; read each one.
- **One workspace, one afternoon.** The agent sees whatever data your local
  workspace happens to hold. A near-empty workspace hides every defect that only
  appears with real volume.
- **The child agent's `Write` tool is not sandboxed to its run directory.** It
  is told where to work and it has no `Bash`, no `Grep` and no `Glob`, so it
  cannot read the repository — but nothing physically stops it writing a file
  somewhere else by absolute path. Check `git status` after a run, the same way
  you would after any agent workflow. The browser is separately restricted:
  Playwright MCP confines file access to its own workspace root by default.
