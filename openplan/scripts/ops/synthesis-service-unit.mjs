#!/usr/bin/env node
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";

const usage = `Usage: node scripts/ops/synthesis-service-unit.mjs
  --worker preparation|execution --app-dir /absolute/openplan
  --env-file /absolute/private.env --state-dir /absolute/private-journals

Prints a systemd user service to stdout. Does not install, enable or start it.
Run with Node 24 on Linux. The environment file and journal directory must exist,
belong to this user and deny group/other access. Keep the same journal directory
used by existing worker commands. Review the generated unit before installing it.
`;

function argumentsFrom(argv) {
  if (argv.length === 1 && argv[0] === "--help") return null;
  const values = {};
  const names = new Set(["--worker", "--app-dir", "--env-file", "--state-dir"]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!names.has(name) || name in values || !value || value.startsWith("--")) {
      throw new Error("Expected each documented option exactly once; use --help.");
    }
    values[name] = value;
  }
  if (Object.keys(values).length !== names.size || !["preparation", "execution"].includes(values["--worker"])) {
    throw new Error("Select preparation or execution and supply all three absolute paths.");
  }
  return values;
}

// Unit specifiers and ExecStart variables expand independently of shell quoting.
function quoted(value, command = false) {
  if (/[\x00-\x1f\x7f]/u.test(value)) throw new Error("Paths must not contain control characters.");
  let escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
  if (command) escaped = escaped.replaceAll("$", () => "$$");
  return `"${escaped}"`;
}

async function checkedPath(value, kind, privateAccess = false) {
  if (!isAbsolute(value)) throw new Error("All paths must be absolute.");
  quoted(value);
  const path = await realpath(value);
  // A harmless-looking symlink can resolve to a path containing unit syntax.
  quoted(path);
  const info = await stat(path);
  if (kind === "directory" ? !info.isDirectory() : !info.isFile()) throw new Error(`Expected a ${kind}.`);
  if (privateAccess && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
    throw new Error("The environment file and journal directory must be owned by this user with no group/other access.");
  }
  return path;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (!options) { process.stdout.write(usage); return; }
  if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) !== 24) {
    throw new Error("This recipe requires Linux and Node 24.");
  }
  const worker = options["--worker"];
  const app = await checkedPath(options["--app-dir"], "directory");
  // WorkingDirectory is a single path setting, not a quoted command argument.
  if (/[\\\s]$/u.test(app)) throw new Error("The application path must not end in whitespace or a backslash.");
  const environment = await checkedPath(options["--env-file"], "file", true);
  const state = await checkedPath(options["--state-dir"], "directory", true);
  const node = await realpath(process.execPath);
  await access(node, constants.X_OK);
  await access(join(app, "package.json"), constants.R_OK);
  await access(join(app, "node_modules/tsx/package.json"), constants.R_OK);
  await access(join(app, `scripts/workers/synthesis-${worker}.ts`), constants.R_OK);
  const variable = worker === "preparation" ? "OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR" : "OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR";
  process.stdout.write(`# Generated for this operator and resolved checkout. Review before installation.
# No permission is created by starting this service. Retain its journals.
[Unit]
Description=OpenPlan synthesis ${worker} worker
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=exec
WorkingDirectory=${app.replaceAll("%", "%%")}
Environment=${quoted(`${variable}=${state}`)}
ExecStart=${quoted(node, true)} ${quoted(`--env-file=${environment}`, true)} --conditions=react-server --import tsx scripts/workers/synthesis-${worker}.ts
Restart=on-failure
RestartSec=5s
KillMode=control-group
KillSignal=SIGTERM
TimeoutStopSec=30s
UMask=0077
NoNewPrivileges=yes
StandardOutput=journal
StandardError=journal
MemoryHigh=1G
MemoryMax=2G
MemorySwapMax=0

[Install]
WantedBy=default.target
`);
}

main().catch(error => {
  // Never echo configuration contents or credentials when setup is refused.
  process.stderr.write(`Service unit not generated: ${error instanceof Error && !('code' in error) ? error.message : "Check the required paths, files and permissions."}\n`);
  process.exitCode = 1;
});
