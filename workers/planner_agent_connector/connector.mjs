#!/usr/bin/env node
import { lstat, readFile, open, chmod, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkedConnectorSetup, ConnectorError, readConnectorConfig } from "./connector-client.mjs";
import { acquireConnectorLock, connectorCycle, privateConnectorDirectory } from "./connector-worker.mjs";
import { inspectCodexConnection } from "./codex-provider.mjs";

const usage = `OpenPlan project connector (Linux, installed Codex 0.154.0)
configure --config /private/directory/connection.json --setup /download/connection.json --binary /installed/bin/codex --profile /native/profile
models --config /private/directory/connection.json
run --config /private/directory/connection.json [--once]

Download a project connection from Planner Agent first. Native sign-in remains in
Codex. API keys and browser sessions are not accepted by this connector. The
selected native account may have usage limits or API charges; no fallback occurs.
`;

export async function connectorMain(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help") { process.stdout.write(usage); return; }
  const allowed = command === "configure" ? ["config", "setup", "binary", "profile"] : command === "run" ? ["config", "once"] : command === "models" ? ["config"] : [];
  if (!allowed.length) throw new ConnectorError("connector_command_invalid");
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index].slice(2);
    if (!args[index].startsWith("--") || !allowed.includes(key) || key in flags) throw new ConnectorError("connector_arguments_invalid");
    if (key === "once") flags[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new ConnectorError("connector_arguments_invalid");
      flags[key] = resolve(value);
    }
  }
  if (!flags.config) throw new ConnectorError("connector_config_required");
  if (command === "configure") {
    if (!flags.setup || !flags.binary || !flags.profile) throw new ConnectorError("connector_arguments_invalid");
    const input = await lstat(flags.setup);
    if (!input.isFile() || input.isSymbolicLink() || input.uid !== process.getuid() || input.size > 20_000) throw new ConnectorError("connector_setup_invalid");
    // Browser downloads may use 0644; importing this explicitly supplied secret
    // restricts the original download as well as the new connection file.
    await chmod(flags.setup, 0o600);
    const setup = checkedConnectorSetup(JSON.parse(await readFile(flags.setup, "utf8")));
    await privateConnectorDirectory(dirname(flags.config));
    const file = await open(flags.config, "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ setup, binaryPath: flags.binary, providerHome: flags.profile }, null, 2)); await file.sync(); }
    finally { await file.close(); }
    process.stdout.write("Project connection saved. Use models to check native sign-in and model access, then run to receive project requests.\n");
    return;
  }
  const config = await readConnectorConfig(flags.config);
  const directory = join(dirname(flags.config), `connector-${config.setup.connectionId}`);
  await privateConnectorDirectory(directory);
  const lock = await acquireConnectorLock(directory);
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const signal = AbortSignal.any([stopped.signal, lock.signal]);
  try {
    if (command === "models") {
      const scratchPath = await mkdtemp(join(directory, "models-"));
      try {
        const account = await inspectCodexConnection({ binaryPath: config.binaryPath, providerHome: config.providerHome, scratchPath, signal, includeModels: true });
        process.stdout.write(`${JSON.stringify(account, null, 2)}\n`);
      } finally { await rm(scratchPath, { recursive: true, force: true }); }
      return;
    }
    let lastStatus;
    do {
      try {
        await connectorCycle(config, directory, { signal, report: status => {
          if (lastStatus !== status) { process.stdout.write(`Project connector: ${status}\n`); lastStatus = status; }
        } });
      } catch (error) {
        if (signal.aborted) break;
        if ([401, 403, 409].includes(error.status) || error instanceof ConnectorError && !["connector_request_refused"].includes(error.code)) throw error;
        // Keep the synced result for an identical delivery retry. No raw HTTP,
        // provider output, project text or credentials enter the terminal log.
        if (lastStatus !== "connection_unavailable") process.stdout.write("Project connector: connection_unavailable; saved delivery retained\n");
        lastStatus = "connection_unavailable";
        if (flags.once) throw error;
      }
      if (flags.once) break;
      await delay(3000, undefined, { signal });
    } while (!signal.aborted);
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await lock.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  connectorMain(process.argv.slice(2)).catch(error => {
    if (error?.name === "AbortError") return;
    const code = error instanceof ConnectorError ? error.code : "connector_unavailable";
    process.stderr.write(`${code}${error?.status ? ` (HTTP ${error.status})` : ""}. No credentials or project text were logged.\n`);
    process.exitCode = 1;
  });
}
