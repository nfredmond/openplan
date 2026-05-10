#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "../..");
const repoRoot = path.resolve(appRoot, "..");

const generatedArtifacts = [
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html",
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf",
];

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  return result.status ?? 1;
}

const generateStatus = run("npm", ["run", "ops:generate-admin-pilot-readiness-proof-packet"], { cwd: appRoot });

if (generateStatus !== 0) {
  process.exit(generateStatus);
}

const diffStatus = run("git", ["diff", "--exit-code", "--stat", "--", ...generatedArtifacts], { cwd: repoRoot });

if (diffStatus !== 0) {
  console.error(
    [
      "Admin Pilot Readiness proof packet drift detected.",
      "Regenerate from openplan/src/lib/operations/pilot-readiness-packet.ts and commit the MD/HTML/PDF artifacts together.",
      "Do not hand-edit buyer claims in generated artifacts; preserve the buyer-safe caveats in source.",
    ].join("\n"),
  );
  process.exit(diffStatus);
}

console.log("Admin Pilot Readiness proof packet artifacts are current.");
