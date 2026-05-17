#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "ops:check-buyer-demo-preflight";
const LIVE_READ_FLAG = "OPENPLAN_BUYER_DEMO_PREFLIGHT_LIVE_READS";

function usage() {
  return [
    "OpenPlan buyer-demo preflight bundle (read-only/local-first)",
    "",
    "Usage:",
    "  npm run ops:check-buyer-demo-preflight",
    "  npm run ops:check-buyer-demo-preflight -- --live-reads",
    "",
    "Default checks:",
    "  - test:sales-proof-claim-boundaries (sales boundary + current buyer proof packet guards)",
    "  - ops:check-pilot-preflight with --skip-health --skip-vercel (local env/migration posture only)",
    "",
    "Options:",
    "  --live-reads    Also allow read-only production health + Vercel inspect via ops:check-pilot-preflight",
    "  --help          Show this help",
    "",
    "Safety boundary:",
    "  This bundle is read-only. It performs no production writes, no schema changes, no seed/provisioning actions,",
    "  no checkout/spend actions, and no secret-value printing. Live external reads are opt-in only.",
    `  Live reads can also be enabled with ${LIVE_READ_FLAG}=1.`,
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    help: false,
    liveReads: process.env[LIVE_READ_FLAG] === "1",
  };

  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--live-reads") {
      args.liveReads = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function buildCommandPlan(options = {}) {
  const pilotArgs = ["run", "ops:check-pilot-preflight", "--"];
  if (!options.liveReads) pilotArgs.push("--skip-health", "--skip-vercel");

  return [
    {
      label: "Sales proof / current buyer packet claim boundaries",
      command: "npm",
      args: ["run", "test:sales-proof-claim-boundaries"],
    },
    {
      label: options.liveReads
        ? "Pilot preflight posture with opt-in read-only live health/deployment reads"
        : "Pilot preflight posture, local/read-only only (live reads skipped)",
      command: "npm",
      args: pilotArgs,
      allowSkippedLiveReadAttention: !options.liveReads,
    },
  ];
}

function isOnlySkippedLiveReadAttention(output) {
  const attentionIndex = output.indexOf("Attention items:");
  if (attentionIndex === -1) return false;
  const attention = output.slice(attentionIndex);
  return (
    attention.includes("production health check skipped by operator flag") &&
    attention.includes("Vercel deployment inspection skipped by operator flag") &&
    !attention.includes("local Supabase:") &&
    !attention.includes("migration inventory:")
  );
}

function runStep(step, cwd = process.cwd()) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${step.label}`);
    console.log(`$ ${step.command} ${step.args.join(" ")}`);

    const child = spawn(step.command, step.args, {
      cwd,
      stdio: step.allowSkippedLiveReadAttention ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    if (step.allowSkippedLiveReadAttention) {
      child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        process.stdout.write(text);
      });
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        process.stderr.write(text);
      });
    }

    child.on("error", (error) => {
      console.error(`Failed to start ${step.command}: ${error.message}`);
      resolve(1);
    });

    child.on("close", (code) => {
      const exitCode = typeof code === "number" ? code : 1;
      if (exitCode !== 0 && step.allowSkippedLiveReadAttention && isOnlySkippedLiveReadAttention(`${stdout}\n${stderr}`)) {
        console.log("\nLocal preflight passed; live production health/deployment reads were intentionally skipped.");
        resolve(0);
        return;
      }
      resolve(exitCode);
    });
  });
}

export async function runBuyerDemoPreflight(options = {}, deps = {}) {
  const plan = deps.plan ?? buildCommandPlan(options);
  const run = deps.runStep ?? runStep;
  const cwd = deps.cwd ?? process.cwd();

  console.log("OpenPlan buyer-demo preflight bundle (read-only/local-first)");
  console.log(`Live external reads: ${options.liveReads ? "enabled" : "disabled"}`);
  console.log("Safety: no production writes, schema changes, seed/provisioning actions, checkout/spend actions, or secret-value printing.");

  for (const step of plan) {
    const code = await run(step, cwd);
    if (code !== 0) {
      console.error(`\nBuyer-demo preflight failed at: ${step.label}`);
      return code;
    }
  }

  console.log("\nBuyer-demo preflight passed.");
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    process.exitCode = await runBuyerDemoPreflight(args);
  } catch (error) {
    console.error(`${SCRIPT_NAME} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
