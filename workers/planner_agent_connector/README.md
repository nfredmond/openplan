# Planner Agent local connector (implementation in progress)

The native transport, scoped connection routes, saved requests, outbound connector
and project controls are implemented. Desktop and 390px browser journeys exercise
actual native answers and a scripted direct API transport on the same narrow task.
See the September 10 provider-connection evidence. Broader A0a/A1 work remains open.

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

The connector never opens a local HTTP listener. A project connection file from
Planner Agent fixes its app origin, project and expected native account mode.
After the browser controls are available, import that downloaded file using:

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
