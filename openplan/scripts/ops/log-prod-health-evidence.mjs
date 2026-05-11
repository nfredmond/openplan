#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runHealthCheck } from "./check-prod-health.mjs";

const execFileAsync = promisify(execFile);
const EXPECTED_VERCEL_STATE = "Ready";

function usage() {
  return [
    "OpenPlan production health evidence logger",
    "",
    "Runs the same public /api/health contract as `npm run ops:check-prod-health`,",
    "then writes a local markdown evidence log for the post-main-push gate.",
    "",
    "Usage:",
    "  npm run ops:log-prod-health-evidence -- --vercel-url <deployment-url> --vercel-state Ready",
    "",
    "Options:",
    "  --health-url <url>           Override OPENPLAN_HEALTH_URL for this run",
    "  --vercel-url <url>           Deployment URL inspected in Vercel",
    "  --vercel-state <state>       Observed Vercel state; use `Ready` only after verification",
    "  --vercel-inspect-json <path> Read saved `vercel inspect --json <url>` output for URL/state",
    "  --require-vercel-ready       Exit non-zero if the resolved Vercel state is not Ready",
    "  --output-dir <path>          Directory for the generated markdown evidence log",
    "  --commit <sha>               Override detected git commit for deterministic tests/manual repair",
    "  --branch <name>              Override detected git branch for deterministic tests/manual repair",
    "  --dry-run                    Print the evidence log instead of writing a file",
    "  -h, --help                   Show this help text",
    "",
    "Operator-safety notes:",
    "  - This helper reads a public health endpoint and writes a local file only.",
    "  - It does not call Supabase, mutate production, or require secret tokens.",
  ].join("\n");
}

function fail(message) {
  throw new Error(message);
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function parseArgs(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }

  return {
    healthUrl: readOption(argv, "--health-url"),
    vercelUrl: readOption(argv, "--vercel-url") ?? process.env.OPENPLAN_VERCEL_DEPLOYMENT_URL,
    vercelState: readOption(argv, "--vercel-state") ?? process.env.OPENPLAN_VERCEL_STATE,
    vercelInspectJson: readOption(argv, "--vercel-inspect-json") ?? process.env.OPENPLAN_VERCEL_INSPECT_JSON,
    outputDir: readOption(argv, "--output-dir") ?? process.env.OPENPLAN_PROD_HEALTH_EVIDENCE_DIR,
    commit: readOption(argv, "--commit"),
    branch: readOption(argv, "--branch"),
    requireVercelReady: argv.includes("--require-vercel-ready"),
    dryRun: argv.includes("--dry-run"),
  };
}

function isoDate(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

function fileTimestamp(isoTimestamp) {
  return isoTimestamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function normalizeDisplay(value, fallback = "not recorded") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizeVercelReadyState(value) {
  const text = normalizeDisplay(value, "");
  if (!text) return "";
  const comparable = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (comparable === "ready") return EXPECTED_VERCEL_STATE;
  return text;
}

function vercelReadyStatus(vercelState) {
  return normalizeVercelReadyState(vercelState) === EXPECTED_VERCEL_STATE;
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function normalizeDeploymentUrl(...values) {
  const text = firstString(...values);
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9.-]+$/i.test(text)) return `https://${text}`;
  return text;
}

function vercelInspectFields(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("--vercel-inspect-json must contain a JSON object");
  }

  const deployment = payload.deployment && typeof payload.deployment === "object" ? payload.deployment : {};
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};

  return {
    url: normalizeDeploymentUrl(
      payload.url,
      payload.deploymentUrl,
      payload.inspectedUrl,
      deployment.url,
      deployment.deploymentUrl,
      meta.url,
    ),
    state: normalizeVercelReadyState(
      firstString(
        payload.state,
        payload.readyState,
        payload.status,
        deployment.state,
        deployment.readyState,
        deployment.status,
        meta.state,
      ),
    ),
  };
}

async function readVercelInspectJson(filePath) {
  if (!filePath) return {};

  let raw;
  try {
    raw = await readFile(path.resolve(filePath), "utf8");
  } catch (error) {
    fail(`Could not read --vercel-inspect-json file: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return vercelInspectFields(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail("--vercel-inspect-json must be valid JSON");
    }
    throw error;
  }
}

async function gitValue(args, fallback) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: process.cwd(), timeout: 5_000 });
    return stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function gitMeta(overrides = {}) {
  return {
    commit: overrides.commit ?? (await gitValue(["rev-parse", "--short=12", "HEAD"], "unknown")),
    branch: overrides.branch ?? (await gitValue(["branch", "--show-current"], "unknown")),
  };
}

function defaultOutputDir(checkedAt) {
  return path.join(process.cwd(), "../docs/ops", `${isoDate(checkedAt)}-test-output`, "prod-health-evidence");
}

function evidenceMarkdown({ healthResult, git, vercelUrl, vercelState }) {
  const vercelReady = vercelReadyStatus(vercelState);
  const decision = vercelReady ? "PASS" : "HOLD";
  const inspectedUrl = normalizeDisplay(vercelUrl);
  const observedState = normalizeDisplay(normalizeVercelReadyState(vercelState));

  return [
    "# OpenPlan production health evidence log",
    "",
    `- Generated: ${healthResult.checkedAt}`,
    "- Helper: `npm run ops:log-prod-health-evidence`",
    "- Scope: public health check + local evidence file only; no production writes and no secrets required.",
    `- Git branch: \`${git.branch}\``,
    `- Git commit: \`${git.commit}\``,
    "",
    "## Vercel Ready verification",
    "",
    `- Deployment URL inspected: ${inspectedUrl}`,
    `- Observed Vercel state: ${observedState}`,
    `- Required post-main-push state: ${EXPECTED_VERCEL_STATE}`,
    `- Result: ${vercelReady ? "PASS — production deployment was verified Ready." : "ACTION REQUIRED — record a Vercel Ready state before closing the post-push gate."}`,
    "",
    "Verification source should be the Vercel deployment page or `vercel inspect <deployment-url>`.",
    "Record the observed state explicitly with `--vercel-state Ready`; do not infer readiness from a passing health check alone.",
    "",
    "## Production health check",
    "",
    "- Command contract: `npm run ops:check-prod-health`",
    `- Health URL: ${healthResult.url}`,
    `- Checked at: ${healthResult.checkedAt}`,
    "- Result: PASS — public `/api/health` returned HTTP 200 for GET and HEAD, disabled caching, and matched the shallow health payload contract.",
    "- Dependency posture: database and billing checks remain intentionally `not_checked` in this shallow endpoint.",
    "",
    "## Closure decision",
    "",
    `- Gate decision: ${decision}`,
    "- Close the post-main-push evidence gate only when Vercel state is `Ready` and the production health check passes.",
    "",
  ].join("\n");
}

async function withHealthUrl(healthUrl, fn) {
  if (!healthUrl) return fn();

  const previous = process.env.OPENPLAN_HEALTH_URL;
  process.env.OPENPLAN_HEALTH_URL = healthUrl;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OPENPLAN_HEALTH_URL;
    } else {
      process.env.OPENPLAN_HEALTH_URL = previous;
    }
  }
}

export async function createEvidenceLog(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    return { help: true, text: usage() };
  }

  const inspectFields = await readVercelInspectJson(options.vercelInspectJson);
  const resolvedVercelUrl = options.vercelUrl ?? inspectFields.url;
  const resolvedVercelState = options.vercelState ?? inspectFields.state;

  const healthResult = await withHealthUrl(options.healthUrl, () => runHealthCheck([]));
  const vercelReady = vercelReadyStatus(resolvedVercelState);
  if (options.requireVercelReady && !vercelReady) {
    fail("Vercel Ready verification is required; rerun with --vercel-state Ready or --vercel-inspect-json after inspecting the deployment.");
  }

  const git = await gitMeta({ commit: options.commit, branch: options.branch });
  const markdown = evidenceMarkdown({
    healthResult,
    git,
    vercelUrl: resolvedVercelUrl,
    vercelState: resolvedVercelState,
  });

  if (options.dryRun) {
    return { dryRun: true, text: markdown, gateDecision: vercelReady ? "PASS" : "HOLD" };
  }

  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir(healthResult.checkedAt));
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${fileTimestamp(healthResult.checkedAt)}-prod-health-evidence.md`);
  await writeFile(outputPath, markdown, "utf8");

  return {
    outputPath,
    gateDecision: vercelReady ? "PASS" : "HOLD",
    checkedAt: healthResult.checkedAt,
    url: healthResult.url,
  };
}

export function formatEvidenceResult(result) {
  if (result.help || result.dryRun) return result.text;

  return [
    `OpenPlan production health evidence log written: ${result.outputPath}`,
    `healthUrl=${result.url}`,
    `checkedAt=${result.checkedAt}`,
    `gateDecision=${result.gateDecision}`,
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await createEvidenceLog(argv);
    console.log(formatEvidenceResult(result));
  } catch (error) {
    console.error(`OpenPlan production health evidence logging failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
