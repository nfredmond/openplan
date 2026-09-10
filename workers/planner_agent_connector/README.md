# Planner Agent local connector

The native transport, scoped connection routes, saved requests, outbound connector
and project controls are implemented. Desktop and 390px browser journeys exercise
actual native answers and a scripted direct API transport on the same narrow task.
That is the v0.52 evidence. The v0.53 Claude extension below has desktop and 390px
transport journeys using the installed CLI with synthetic OAuth and local scripted
responses. Live Claude quality and account allowance remain unmeasured. Broader
A0a/A1 work remains open.

The initial native transport uses installed standalone Codex **0.154.0** on Linux,
Node 24 and `/usr/bin/bwrap`. It accepts a resolved native binary in a `bin`
directory; unsupported versions and profile symlinks fail explicitly. This narrow
version boundary is intentional: a new native build requires protocol and
capability acceptance before support is widened. No binary or paid service is
installed automatically.

Codex owns its existing `auth.json` and refresh lifecycle. The connector neither
reads credential contents nor copies them to OpenPlan. Each process sees a private
working directory, native runtime files, system runtime/certificate files and its
provider profile. Every pre-existing profile entry except `auth.json` is overlaid
with an empty private file/directory inside the process; source configuration,
instructions, skills and histories are unchanged. Host project directories,
browser profiles, user runtime sockets and app environment credentials are not
mounted or inherited. Provider authentication files are available to the native
runtime, not exposed as model tools. This is an installed native process boundary,
not permission to execute OpenPlan business actions.

Both thread and turn explicitly disable computer environments. Browser, apps,
plugins, hooks, memories, shell and image-generation capabilities are disabled.
The installed version still exposes native planning/input and skills discovery
interfaces; inherited user skills are masked. Unsupported provider permission
requests receive a protocol refusal. No dynamic project tools are enabled by the
current project-turn wrapper: it receives the frozen selected record, returns a
structured draft, and leaves approval/execution to the existing app path.

The account mode is checked before the turn; a mismatch stops before generation.
The requested model must match the started model. Missing auth, changed account
mode, native process failure, usage limits, oversized output, interrupted streams
and missing completion remain errors. A successful start or text fragment is not
a completed turn. The connector owns and closes its child; it never terminates
another agent's process.

From the repository root:

```sh
node --test workers/planner_agent_connector/test/*.test.mjs
```

The connection to OpenPlan uses outbound HTTP. OpenCode also uses private
loopback listeners for its owned native server and bounded provider relay, as
described below. A project connection file from Planner Agent fixes its app
origin, project and expected native account mode.
Import that downloaded file using:

```sh
node workers/planner_agent_connector/connector.mjs configure \
  --config "$HOME/.local/state/openplan-connectors/project/connection.json" \
  --setup "$HOME/Downloads/openplan-connection.json" \
  --binary /absolute/path/to/standalone/bin/codex --profile "$HOME/.codex"
node workers/planner_agent_connector/connector.mjs models \
  --config "$HOME/.local/state/openplan-connectors/project/connection.json"
node workers/planner_agent_connector/connector.mjs run \
  --config "$HOME/.local/state/openplan-connectors/project/connection.json"
```

Choose a new private configuration directory for each connection. Configuration
refuses to overwrite an existing file and restricts both the imported download
and saved config to the current user. Native sign-in remains in Codex's supported
login flow. `models` prints only sanitized native account mode/plan and catalog.
Ctrl+C stops the owned connector; rerun the same command to recover. `run --once` exits nonzero when the app is unavailable; ordinary continuous mode
retains its journal and polls again. One OS lock
prevents two connector processes from consuming the same local journal.

Completed output is synced before delivery and resent identically after a network
interruption. A process loss during generation records interruption without
another automatic model call. Cancellation or expiry discards that attempt's
publication authority. Revoked/denied connections stop and retain undelivered
output privately. Reconnect from the app using a new connection if access was
revoked. The connector removes only its own temporary native directories after
the native process exits; the saved request/result remains in OpenPlan and its
pending-delivery journal. No daemon, paid service, API fallback or global process
termination is installed by these commands.

The no-cost native isolation tests are named skips unless a tested standalone
binary is explicitly supplied:

```sh
OPENPLAN_CODEX_NATIVE_BINARY=/absolute/path/to/standalone/bin/codex \
  node --test workers/planner_agent_connector/test/codex-native-isolation.test.mjs
```

These use a local scripted Responses server, synthetic account data and temporary
profiles. They force shell, file-reading, patch and MCP calls and inspect the
actual runtime refusals and model-visible context. No real provider request is
made. Retained synthetic fixtures are printed for inspection. Separately, the
September 10 implementation evidence records native account detection and real
ChatGPT-authenticated synthetic project answers through the desktop and 390px app
journeys. These do not prove all native platforms/backends, professional usefulness,
live Anthropic quality or general agent assignments.

## Claude Code extension

The connector also supports installed Claude Code **2.1.263** on Linux through
version 2 connection files. Choose Installed Claude Code in the project task
panel, create a connection and download its file. Use the same configure command,
with the Claude binary and native profile instead:

```sh
node workers/planner_agent_connector/connector.mjs configure \
  --config "$HOME/.local/state/openplan-connectors/claude-project/connection.json" \
  --setup "$HOME/Downloads/openplan-connection.json" \
  --binary "$HOME/.local/bin/claude" --profile "$HOME/.claude"
```

Run models and run with that config path. Claude's models command checks native
sign-in without generating; it reports modelsUnavailable because this adapter has
no tested non-generating model catalog. Supply an exact claude- model identifier
that your account supports. Unsupported versions and models fail without switching
provider, model or account mode. Existing version 1 Codex files remain readable.

Claude subscription sign-in stays in Claude Code. API-key, cloud-provider and
signed-out modes are refused by this native adapter. Subscription limits still
apply. OpenPlan cannot inspect whether the account has enabled paid extra usage;
disable that setting in Claude to prevent extra charges. Fast mode is disabled.
No API key or paid service is supplied by this connector.

Claude owns its private .credentials.json and atomic refresh. Other existing
profile entries are masked, with valid empty objects for JSON files. Safe mode,
empty settings sources and tool lists, strict empty MCP configuration, replaced
system instructions and disabled session persistence restrict the task to the
frozen project packet. Managed /etc/claude-code policy environments are currently
refused. Root/overlapping scratch paths, non-private credential files, profile
symlinks and unsupported native versions are refused before a task starts.

```sh
OPENPLAN_CLAUDE_NATIVE_BINARY="$HOME/.local/bin/claude" \
  node --test workers/planner_agent_connector/test/claude-native-isolation.test.mjs
```

This fixture runs the installed CLI with synthetic OAuth and local scripted
Messages responses. It proves native refusals, bounded structured output, dispatch,
account-status inspection and interruption behavior. It does not establish live
Claude model availability, output quality, account allowance or extra-usage
settings. See [Claude verification](../../docs/reviews/2026-09-10-claude-native-spike/VERIFICATION.md).

## OpenCode extension, development candidate

The candidate extends the same project task to installed OpenCode **1.18.30** on
Linux. App/browser and release acceptance are still in progress. Version-two
connection files explicitly bind provider opencode and account mode opencode_api.
Only the native OpenAI API credential is supported in this increment. OAuth,
subscription sign-in and other OpenCode providers remain unfinished scope.
OpenPlan supplies no provider credit, and each API request requires explicit
charge acknowledgement in the app.

Choose Installed OpenCode in the project task and download its connection file.
Configure a fresh private directory using the installed binary and the directory
containing OpenCode's private auth.json. For a default Linux XDG data location:

```sh
node workers/planner_agent_connector/connector.mjs configure \
  --config "$HOME/.local/state/openplan-connectors/opencode-project/connection.json" \
  --setup "$HOME/Downloads/openplan-connection.json" \
  --binary /absolute/path/to/opencode \
  --profile "$HOME/.local/share/opencode"
node workers/planner_agent_connector/connector.mjs models \
  --config "$HOME/.local/state/openplan-connectors/opencode-project/connection.json"
node workers/planner_agent_connector/connector.mjs run \
  --config "$HOME/.local/state/openplan-connectors/opencode-project/connection.json"
```

Sign in through OpenCode itself. The connector reads only its exact openai API
record from a regular, private, current-user-owned auth.json and creates a
read-only snapshot for that attempt. It leaves the source profile unchanged.
Missing, malformed, public-readable or unsupported credentials are refused.
The models command runs without network access and reports the pinned native
catalog, not live model availability or account entitlement. In the app, enter
the model ID without the openai/ prefix. No substitute model is selected.

The native process has a fresh private filesystem, fixed instructions and only
the StructuredOutput tool. Existing native histories, plugins, MCP servers,
shell tools and user configuration are unavailable to the task. An authenticated
loopback server owns the session. A separate private loopback relay permits one
bounded OpenAI Responses request to the fixed official endpoint; neither endpoint
can be supplied through a connection file. The connector validates the exact
assistant message and its native readback, then waits for process exit before
removing its temporary files. Native list-message history has an upstream schema
failure in this version; OpenPlan retains its own validated answer and exact
request identity. It does not claim general OpenCode history integration.

```sh
OPENPLAN_OPENCODE_NATIVE_BINARY=/absolute/path/to/opencode \
  node --test workers/planner_agent_connector/test/opencode-native-filesystem.test.mjs
```

Native evidence uses synthetic credentials and local scripted Responses data.
It does not establish real account access, provider billing or professional
usefulness. See the [OpenCode implementation checkpoint](../../docs/reviews/2026-09-10-opencode-native-spike/CHECKPOINT.md).
