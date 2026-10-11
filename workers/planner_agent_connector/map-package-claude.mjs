// How a map package run starts Claude Code, and how its stream is read.
//
// Unlike a Planner Agent turn, the skill needs a shell, Python with QGIS, file
// writes and the network for hours. Claude Code's own controls keep it in the
// run folder: the planner's settings files are ignored, every tool not
// pre-approved is refused (dontAsk), file writes are pre-approved only inside
// the run folder, file reads outside the working folders are blocked, and every
// shell command runs in the operating-system sandbox, which cannot read the
// Claude credentials or this connector's folder. Every model alias and the
// subagent model are pinned, so only the requested model runs the skill.
import { basename } from "node:path";

export const CLAUDE_MAP_MIN_VERSION = [2, 1, 263];
export const CLAUDE_MAP_MAX_TURNS = 5000;

/**
 * Hosts a sandboxed shell command may reach. The skill reads public data from
 * agency servers that differ by project, so the list is every common top-level
 * domain rather than named hosts. It does not widen file access.
 */
export const CLAUDE_MAP_NETWORK_DOMAINS = [
  "*.gov", "*.us", "*.mil", "*.edu", "*.org", "*.com", "*.net", "*.io", "*.info", "*.int", "*.app", "*.dev", "*.co",
  "*.ai", "*.cloud", "*.eu", "*.de", "*.uk", "*.ca", "*.fr", "*.nl", "*.ch", "*.at", "*.be", "*.dk", "*.se", "*.no",
  "*.fi", "*.es", "*.it", "*.ie", "*.pl", "*.cz", "*.au", "*.nz", "*.jp", "*.mx", "*.br",
];

export function parseClaudeVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)\s*$/.exec(String(text ?? ""));
  return match ? match.slice(1, 4).map(Number) : null;
}

export function claudeVersionAtLeast(version, minimum = CLAUDE_MAP_MIN_VERSION) {
  if (!version) return false;
  for (let index = 0; index < 3; index++) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index];
  }
  return true;
}

/** Settings for this run only, passed with --settings. Absolute paths throughout. */
export function claudeMapSettings({ runDir, claudeConfigDir, connectorDir, home }) {
  for (const path of [runDir, claudeConfigDir, connectorDir, home]) {
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\n")) throw new Error("map_run_path_invalid");
  }
  if (runDir === connectorDir || runDir.startsWith(`${connectorDir}/`) || connectorDir === home || claudeConfigDir === home) {
    throw new Error("map_run_path_invalid");
  }
  const secretDirs = [claudeConfigDir, connectorDir, `${home}/.claude.json`, `${home}/.ssh`, `${home}/.aws`, `${home}/.gnupg`,
    `${home}/.config/gcloud`, `${home}/.codex`, `${home}/.local/share/opencode`, `${home}/.netrc`, `${home}/.docker`, `${home}/.kube`];
  const rule = path => `/${path}/**`;
  // A rule for the path itself and for everything under it, so a file is covered as well as a folder.
  const both = (tool, path) => [`${tool}(/${path})`, `${tool}(${rule(path)})`];
  return {
    permissions: {
      defaultMode: "dontAsk",
      blockReadsOutsideWorkingDirectories: true,
      allow: [
        `Read(${rule(runDir)})`, `Edit(${rule(runDir)})`, `Write(${rule(runDir)})`,
        "Glob", "Grep", "WebFetch", "WebSearch", "Skill", "Agent", "Task", "TodoWrite",
      ],
      deny: secretDirs.flatMap(path => [...both("Read", path), ...both("Edit", path), ...both("Write", path)]),
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      network: { allowedDomains: CLAUDE_MAP_NETWORK_DOMAINS },
      filesystem: { denyRead: secretDirs },
      credentials: { files: [claudeConfigDir, connectorDir].map(path => ({ path, mode: "deny" })) },
    },
  };
}

export function claudeMapArgs({ model, effort, pluginDir, settings }) {
  if (!/^claude-[a-z0-9-]{1,140}$/.test(model ?? "") || !["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("map_run_model_invalid");
  }
  return [
    "--print", "--output-format", "stream-json", "--verbose",
    "--model", model, "--effort", effort,
    "--setting-sources", "", "--settings", JSON.stringify(settings),
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--tools", "default", "--plugin-dir", pluginDir,
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--no-chrome", "--max-turns", String(CLAUDE_MAP_MAX_TURNS),
  ];
}

/**
 * A minimal environment: no inherited API key (Claude Code would bill it
 * instead of the subscription), no inherited secrets, and every model alias
 * pinned to the requested model.
 */
export function claudeMapEnv({ model, home, claudeConfigDir, path, censusApiKey }) {
  return {
    HOME: home, PATH: path, LANG: "C.UTF-8", CLAUDE_CONFIG_DIR: claudeConfigDir, QT_QPA_PLATFORM: "offscreen",
    ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL: model,
    DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1",
    ...(censusApiKey ? { CENSUS_API_KEY: censusApiKey } : {}),
  };
}

function clip(text, max) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A short, plain line for the package page. File paths become file names; URLs become host names. */
export function progressLineForToolUse(block) {
  const input = block?.input && typeof block.input === "object" ? block.input : {};
  switch (block?.name) {
    case "Bash": return clip(input.description || `Running ${String(input.command ?? "").trim().split(/\s+/)[0] || "a command"}`, 200);
    case "Read": return clip(`Reading ${basename(String(input.file_path ?? "a file"))}`, 200);
    case "Write": return clip(`Writing ${basename(String(input.file_path ?? "a file"))}`, 200);
    case "Edit": return clip(`Editing ${basename(String(input.file_path ?? "a file"))}`, 200);
    case "WebFetch": {
      try { return clip(`Reading ${new URL(String(input.url)).hostname}`, 200); } catch { return "Reading a web page"; }
    }
    case "WebSearch": return clip(`Searching: ${input.query ?? ""}`, 200);
    case "Agent": case "Task": return clip(`Asking a reviewer: ${input.description ?? ""}`, 200);
    case "Skill": return clip(`Using the ${input.skill ?? input.name ?? ""} skill`, 200);
    case "TodoWrite": return "Updating its plan";
    default: return clip(block?.name ? `Using ${block.name}` : "Working", 200);
  }
}

/**
 * Fold one stream-json event into the run state. The init event must name the
 * requested model and no API key; the result event carries the usage that
 * becomes the receipt.
 */
export function foldClaudeMapEvent(state, event) {
  if (!event || typeof event !== "object") return state;
  if (event.type === "system" && event.subtype === "init") {
    return { ...state, init: { model: event.model ?? null, apiKeySource: event.apiKeySource ?? null, sessionId: event.session_id ?? null } };
  }
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    let next = state;
    for (const block of event.message.content) {
      if (block?.type === "tool_use") {
        const line = progressLineForToolUse(block);
        next = { ...next, steps: next.steps + 1, message: line, recent: [...next.recent, line].slice(-20) };
      } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        next = { ...next, message: clip(block.text, 300) };
      }
    }
    return next;
  }
  if (event.type === "result") {
    const usage = event.usage && typeof event.usage === "object" ? event.usage : null;
    const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
    return { ...state, result: {
      subtype: typeof event.subtype === "string" ? event.subtype : null,
      isError: event.is_error === true,
      sessionId: typeof event.session_id === "string" ? event.session_id : null,
      numTurns: Number.isSafeInteger(event.num_turns) ? event.num_turns : null,
      durationMs: Number.isSafeInteger(event.duration_ms) ? event.duration_ms : null,
      modelsUsed: event.modelUsage && typeof event.modelUsage === "object" ? Object.keys(event.modelUsage).sort() : [],
      usage: usage ? {
        inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens),
        cacheReadInputTokens: count(usage.cache_read_input_tokens), cacheCreationInputTokens: count(usage.cache_creation_input_tokens),
      } : null,
    } };
  }
  return state;
}

export function initialClaudeMapState() {
  return { init: null, result: null, steps: 0, message: "Starting", recent: [] };
}
