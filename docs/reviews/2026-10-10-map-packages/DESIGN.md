# Map packages: design, 2026-10-10

Status: phase A built on branch `work/agent-model-policy-20261010`. Nothing
here has run against a live model. See "What is not proven" and
[VERIFICATION.md](VERIFICATION.md).

## What Nathaniel asked for

On 2026-10-10 Nathaniel asked for his `transportation-gis` skill to become an
OpenPlan module. The skill takes a project brief and builds a client-ready map
package: figures as PDF, PNG and layered SVG, map books, an offline website, a
Google Earth KMZ, a QGIS project, an ArcGIS Pro builder with agent instructions,
an Illustrator kit, QA and a transfer ZIP. A second agent session later uses
that package to build the native ArcGIS Pro or QGIS project with computer use.

His directions, recorded as given:

- Planners run it through their own Claude Code or Codex (subscription), or
  through an API key when a company pays. The API path needs no installed CLI.
- Claude Fable 5.1 is the only model that should run the skill. GPT-6 Astra is
  a far second. No other model may run it.
- A run can take six hours or more. Do not test the skill during development;
  he iterated on it the week before and it works.
- References to specific projects in the skill become generic.
- The first workflow (build the package) must be available and joined to the
  rest of the app. The second (native build by computer use) may come later.

## Where it lives

Nathaniel asked for a new module. `AGENTS.md` requires a current whole-product
review before a new module. That review has not been performed. This note
records his direction and the reasoning, and does not claim a review happened.

No existing home produces a cartographic deliverable for outside GIS tools.
Data Hub and workspace GIS hold the agency's layers; reports draw a small
location figure; the project GeoPackage export carries three layers. None
builds figures, map books or native GIS projects. So:

- **Records live on the project.** A map package belongs to one project and one
  workspace, like an evidence bundle. Workspace members can read it.
- **A Maps page** (top-level, worklist) lists every package in the workspace and
  starts a new one (guided flow). Each package has its own page.
- **Entry points** where planners need maps: the project page, and a grant
  application (the brief then names the program and its deadline).
- **Works without an agent.** A planner can add a package they built by hand
  (upload a ZIP). The agent path is one way to make a package, not the only way.

## Phases

| Phase | Scope | State |
|---|---|---|
| A | Skill vendored and made generic; package records, storage and routes; native runs through Claude Code with Fable 5.1; Maps pages and entry points; upload path | This branch |
| B | API-direct worker: a container with QGIS and the CLI, run with the workspace's API key | Not started |
| C | GPT-6 Astra through Codex, after a sandbox probe proves the agent cannot read Codex credentials | Not started |
| D | Second workflow: native ArcGIS Pro or QGIS build by computer use on a Windows or Linux computer | Not started; Phase A shows the manual hand-off |
| E | Figures into grant checklists and reports (`kb_documents` exhibits) | Not started |

## Phase A architecture

### The skill

`workers/planner_agent_connector/map-package-skill/transportation-gis/` holds
the skill with project-specific examples made generic. Its Python code is
unchanged apart from two example strings in help and error text. A manifest
(`MANIFEST.json`: every file with its sha256, and a tree hash) is checked by a
test, so an edit without a manifest update fails CI. The app knows the tree
hash it expects; the connector refuses a run when its copy differs.

### Records and storage

- `project_map_packages`: one row per package. Source is `agent` or `upload`.
  Agent rows carry the connection, provider, model, effort, the frozen brief
  (canonical JSON and sha256), state, attempt, lease, heartbeat, progress, the
  receipt and the stored files. The database allows only Fable 5.1 on Claude
  and GPT-6 Astra on Codex.
- `project_map_package_files`: the ZIP, figure previews and the run report,
  each with path, size and sha256.
- Bucket `project-map-packages`: private, no storage policies. Bytes move only
  through signed URLs that a route issues after checking access. Default size
  ceiling 1 GiB per object (`OPENPLAN_MAP_PACKAGE_MAX_BYTES`). The local
  Supabase config raises its global upload limit to match.

### The run

1. The planner picks the project, what the maps are for, whose name goes on
   them, and anything the agent should know. The app freezes a brief: project,
   place, study area and corridors as GeoJSON, the grant application if any,
   the request and the voice.
2. The connector on the planner's computer (`connector.mjs maps`, separate from
   the Planner Agent loop so a six-hour run does not block questions) claims the
   run, checks the skill hash and writes a run folder under
   `~/OpenPlan Map Packages/`. The folder holds the brief, the study area and a
   working copy of the skill.
3. It starts Claude Code with Fable 5.1 at high effort (recipe below), renews
   the lease every minute, and sends progress lines.
4. When the agent finishes, the connector checks that only Fable 5.1 ran,
   finds the ZIP, hashes it, uploads it and the figure previews through signed
   URLs, and finishes. The server re-reads each object and checks size and
   sha256 before the package becomes ready.
5. A connector restart never starts the model again. If the ZIP already
   exists, only the upload resumes; otherwise the run is recorded as
   interrupted and the folder stays on the computer.

### Claude Code launch recipe

The existing Planner Agent connector runs Claude Code with no tools. A map run
needs shell, Python with QGIS, file writes and the network. The recipe keeps
the agent in the run folder and away from credentials:

- `--setting-sources ""` ignores the planner's own settings files.
- `--permission-mode dontAsk` refuses anything not pre-approved. File writes
  are pre-approved only inside the run folder; file reads outside the working
  folders are blocked (`blockReadsOutsideWorkingDirectories`).
- `--settings` turns on the shell sandbox (`failIfUnavailable`,
  `allowUnsandboxedCommands: false`), denies reads of the Claude credential
  folder, the folder holding the connection file, `~/.ssh` and similar, and
  lists the network domains the data sources need. `--restricted` was
  considered and not used: whether `--tools default` re-enables the shell
  under it is undocumented.
- `--plugin-dir` loads the skill from the run folder.
- `--model claude-fable-5-1 --effort high`, with every model alias and the
  subagent model pinned to Fable 5.1 so no other model runs.

### What is not proven

Each item needs a live run, which uses Nathaniel's subscription or an API key:

- The recipe above holds: the agent cannot read the credential, cannot write
  outside the run folder, and can reach the data sources.
- `--plugin-dir` loads the skill under `--restricted`.
- A network allowlist of top-level-domain wildcards (`*.gov`, `*.com`, ...)
  admits the hosts the skill uses. The documentation describes subdomain
  wildcards; it does not say whether a bare `*` is accepted.
- QGIS renders inside the shell sandbox.
- A full six-hour run completes and uploads.

A short probe (`connector.mjs maps probe`) is planned to check the first four
in a few minutes before any full run.

## Phase C groundwork: Codex containment probe, 2026-10-10

`codex sandbox` (Codex 0.162.1) runs a shell command under Codex's own sandbox
with no model call. Results on this computer:

| Profile | Read `~/.codex/auth.json` | Write outside folder | Write in folder | Network | QGIS import |
|---|---|---|---|---|---|
| Default (`codex sandbox`, no profile) | readable | denied | denied | not tested | not tested |
| `extends = ":workspace"`, `~/.codex/auth.json = "deny"`, network enabled | denied | denied | allowed | reached TIGERweb | works |
| Same, without the deny (control) | readable | | | | |
| Same deny, network not enabled (control) | | | | refused | |

Denying all of `~/.codex` breaks Codex itself, because the binary lives under
`~/.codex/packages` and runs inside the sandbox; the deny must name the
credential file. The profile was passed as `-c` overrides
(`default_permissions`, `permissions.<name>.extends`, `.filesystem`,
`.network`). Codex ignores permission profiles when `sandbox_mode` is set in a
loaded config, so a run needs `--ignore-user-config`.

Still open before Astra runs: whether `codex exec` can ever answer with a model
other than the one named by `-m`, which subagent model it uses, and the exact
JSONL event shapes of this version. Each needs a short live run on the
planner's ChatGPT account.
