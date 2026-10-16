#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installerGuidance } from "./installer-guidance.mjs";

const help = `Read-only Planner Agent installer guidance (Linux)
node workers/planner_agent_connector/installer-guidance-cli.mjs --provider codex|claude|opencode --binary /absolute/provider/path [--installer npm --npm-root /absolute/global/node_modules]

If npm owns this installation, obtain its global root with npm root --global.
Supply that root and declare npm only for an npm-owned installation. Otherwise
the installer stays unknown. The inspection reads bounded package metadata and
checks its binary entry. It never runs the binary, npm, a model or an update.
The printed command targets OpenPlan's tested version. Run it yourself only
after confirming the owning installer and stopping sessions that use that binary.
This command does not establish native compatibility or account access.
`;

export async function installerGuidanceMain(args) {
  if (args.length === 1 && args[0] === "--help") return help;
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!["--provider", "--binary", "--installer", "--npm-root"].includes(key) || Object.hasOwn(flags, key) ||
        typeof args[index + 1] !== "string" || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("installer_guidance_arguments_invalid");
    flags[key] = args[index + 1];
  }
  if (!flags["--provider"] || !flags["--binary"] ||
      Boolean(flags["--installer"]) !== Boolean(flags["--npm-root"]) ||
      (flags["--installer"] && flags["--installer"] !== "npm")) throw new Error("installer_guidance_arguments_invalid");
  const result = await installerGuidance({ provider: flags["--provider"], binaryPath: flags["--binary"],
    installer: flags["--installer"], npmGlobalRoot: flags["--npm-root"] });
  return `${JSON.stringify(result, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  installerGuidanceMain(process.argv.slice(2)).then(output => process.stdout.write(output)).catch(() => {
    process.stderr.write("installer_guidance_refused. No installer or binary ran.\n");
    process.exitCode = 1;
  });
}
