# Planner Agent local connector (implementation in progress)

The native transport is implemented; device pairing, saved requests and the app
controls are still being connected. This is not yet an end-user launch command or
an A0a completion claim.

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
September 10 implementation evidence records native account detection and one real
ChatGPT-authenticated synthetic project answer; neither proves the unfinished app
journey, all native platforms/backends, professional usefulness or general agent
assignments.
