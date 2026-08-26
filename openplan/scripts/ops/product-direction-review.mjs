#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const APP_ROOT = resolve(REPO_ROOT, "openplan");
const CONTRACT_PATH = resolve(REPO_ROOT, "docs/product/V1_PRODUCT_CONTRACT.md");
const ROADMAP_PATH = resolve(REPO_ROOT, "docs/ROADMAP.md");
const PROTOCOL_PATH = resolve(
  REPO_ROOT,
  "docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md",
);
const MATRIX_PATH = resolve(
  REPO_ROOT,
  "docs/product/US_PLANNING_CAPABILITY_MATRIX.md",
);
const VALIDATION_RESEARCH_PATH = resolve(
  REPO_ROOT,
  "docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md",
);
const REVIEW_DIR = resolve(REPO_ROOT, "docs/reviews/product-direction");
const REVIEW_MARKER = "openplan-product-direction-review";
const CONTRACT_MARKER = "openplan-v1-product-contract";
const MATRIX_MARKER = "openplan-planning-capability-matrix";
const MAX_REVIEW_DAYS = 31;

const REQUIRED_PERSPECTIVES = [
  "transportation-and-travel-model-science",
  "land-use-statutory-and-development-planning",
  "environmental-climate-resilience-and-equity",
  "community-engagement-title-vi-and-public-decisions",
  "capital-programming-grants-delivery-and-reimbursement",
  "rural-tribal-small-and-capacity-constrained-agencies",
  "gis-data-evidence-and-public-records",
  "agency-operations-accessibility-and-recovery",
  "adversarial-product-strategy",
];

const REQUIRED_DECISIONS = [
  "ultimate-us-planning-operating-system",
  "all-planner-types",
  "all-fifty-states-and-dc",
  "california-gold-standard",
  "nationwide-validated-dual-demand-model",
  "no-calendar-or-runtime-scope-reduction",
  "preserve-independent-disagreement",
  "recheck-old-agent-decisions",
  "self-service-free-open-source",
  "human-control-and-evidence",
];

const REQUIRED_CAPABILITIES = [
  "long-range-transportation-and-regional-planning",
  "land-use-comprehensive-and-community-planning",
  "travel-demand-corridor-scenario-and-performance-analysis",
  "transit-active-transportation-freight-and-safety-planning",
  "environmental-review-climate-resilience-and-equity",
  "community-engagement-title-vi-and-public-decisions",
  "capital-programming-prioritization-grants-delivery-and-reimbursement",
  "gis-data-stewardship-documents-reports-and-public-records",
  "development-review-implementation-and-interdepartmental-handoff",
];

const REQUIRED_ORGANIZATIONS = [
  "local-and-county-government",
  "regional-and-metropolitan-organizations",
  "state-agencies",
  "tribal-governments",
  "transit-and-multimodal-providers",
  "consultancies",
  "nonprofits-community-groups-and-independent-planners",
];

const REQUIRED_GEOGRAPHIES = [
  "all-fifty-states-and-dc",
  "us-territories-explicitly-assessed",
  "california-gold-standard",
  "metropolitan-suburban-rural-and-remote",
  "tribal-border-island-mountain-and-coastal",
];

const REQUIRED_STATUSES = ["proven", "partial", "missing", "not-assessed"];

function fail(message) {
  throw new Error(`Product-direction review check failed: ${message}`);
}

function markerBlock(markdown, marker, source) {
  const block = markdown.match(new RegExp(`<!-- ${marker}\\n([\\s\\S]*?)-->`))?.[1];
  if (!block) fail(`${source} is missing a closed ${marker} metadata block`);
  return block;
}

function field(block, name) {
  const match = block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  if (!match) fail(`metadata is missing ${name}`);
  return match[1].trim();
}

function list(block, name) {
  const match = block.match(new RegExp(`^${name}:\\s*\\n((?:- .+\\n?)+)`, "m"));
  if (!match) fail(`metadata is missing ${name}`);
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim());
}

function dateValue(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) fail(`${name} is not a real date`);
  return date;
}

function relative(path) {
  return path.replace(`${REPO_ROOT}/`, "");
}

function currentRelease() {
  const packageJson = JSON.parse(readFileSync(resolve(APP_ROOT, "package.json"), "utf8"));
  return `v${packageJson.version}`;
}

function latestReviewPath() {
  const reviews = readdirSync(REVIEW_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(name))
    .sort();
  if (reviews.length === 0) fail(`no dated review exists under ${relative(REVIEW_DIR)}`);
  return resolve(REVIEW_DIR, reviews.at(-1));
}

function assertContainsAll(actual, required, name) {
  const missing = required.filter((value) => !actual.includes(value));
  if (missing.length > 0) fail(`${name} is missing: ${missing.join(", ")}`);
}

function runCheck() {
  for (const path of [
    CONTRACT_PATH,
    MATRIX_PATH,
    ROADMAP_PATH,
    PROTOCOL_PATH,
    VALIDATION_RESEARCH_PATH,
    REVIEW_DIR,
  ]) {
    if (!existsSync(path)) fail(`required path does not exist: ${relative(path)}`);
  }

  const release = currentRelease();
  const contract = readFileSync(CONTRACT_PATH, "utf8");
  const contractBlock = markerBlock(contract, CONTRACT_MARKER, relative(CONTRACT_PATH));
  if (field(contractBlock, "current_release") !== release) {
    fail(`contract release does not match package release ${release}`);
  }

  const matrix = readFileSync(MATRIX_PATH, "utf8");
  const matrixBlock = markerBlock(matrix, MATRIX_MARKER, relative(MATRIX_PATH));
  if (field(matrixBlock, "current_release") !== release) {
    fail(`capability matrix release does not match package release ${release}`);
  }
  const matrixReviewDate = dateValue(field(matrixBlock, "review_date"), "matrix review_date");
  const matrixReviewByText = field(matrixBlock, "review_by");
  const matrixReviewBy = dateValue(matrixReviewByText, "matrix review_by");
  const matrixReviewSpan = Math.round((matrixReviewBy - matrixReviewDate) / 86_400_000);
  if (matrixReviewSpan < 1 || matrixReviewSpan > MAX_REVIEW_DAYS) {
    fail(`capability matrix review interval is ${matrixReviewSpan} days; expected 1-${MAX_REVIEW_DAYS}`);
  }
  assertContainsAll(list(matrixBlock, "capabilities"), REQUIRED_CAPABILITIES, "capabilities");
  assertContainsAll(list(matrixBlock, "organizations"), REQUIRED_ORGANIZATIONS, "organizations");
  assertContainsAll(list(matrixBlock, "geographies"), REQUIRED_GEOGRAPHIES, "geographies");
  assertContainsAll(list(matrixBlock, "statuses"), REQUIRED_STATUSES, "statuses");

  const reviewPath = latestReviewPath();
  const review = readFileSync(reviewPath, "utf8");
  const block = markerBlock(review, REVIEW_MARKER, relative(reviewPath));
  const reviewDateText = field(block, "review_date");
  const reviewByText = field(block, "review_by");
  const reviewDate = dateValue(reviewDateText, "review_date");
  const reviewBy = dateValue(reviewByText, "review_by");
  const reviewSpan = Math.round((reviewBy - reviewDate) / 86_400_000);
  if (reviewSpan < 1 || reviewSpan > MAX_REVIEW_DAYS) {
    fail(`review interval is ${reviewSpan} days; expected 1-${MAX_REVIEW_DAYS}`);
  }

  const todayText = new Date().toISOString().slice(0, 10);
  if (reviewByText < todayText) fail(`latest review expired on ${reviewByText}`);
  if (matrixReviewByText < todayText) {
    fail(`capability matrix review expired on ${matrixReviewByText}`);
  }
  if (field(block, "current_release") !== release) {
    fail(`latest review release does not match package release ${release}`);
  }

  const independentContexts = Number.parseInt(field(block, "independent_contexts"), 10);
  if (!Number.isInteger(independentContexts) || independentContexts < 2) {
    fail("latest review requires at least two independent fresh contexts");
  }

  assertContainsAll(list(block, "perspectives"), REQUIRED_PERSPECTIVES, "perspectives");
  assertContainsAll(list(block, "decisions"), REQUIRED_DECISIONS, "decisions");

  for (const path of list(block, "paths")) {
    if (!existsSync(resolve(REPO_ROOT, path))) fail(`review source path is missing: ${path}`);
  }

  const reviewedCommit = field(block, "reviewed_commit");
  if (!/^[0-9a-f]{8,40}$/.test(reviewedCommit)) fail("reviewed_commit is not a Git hash");
  try {
    execFileSync("git", ["cat-file", "-e", `${reviewedCommit}^{commit}`], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  } catch {
    fail(`reviewed_commit is not available: ${reviewedCommit}`);
  }

  const contractReview = field(contractBlock, "direction_review");
  if (resolve(REPO_ROOT, contractReview) !== reviewPath) {
    fail(`contract points to ${contractReview}, not latest review ${relative(reviewPath)}`);
  }
  const contractMatrix = field(contractBlock, "capability_matrix");
  if (resolve(REPO_ROOT, contractMatrix) !== MATRIX_PATH) {
    fail(`contract points to ${contractMatrix}, not ${relative(MATRIX_PATH)}`);
  }
  const contractPaths = {
    review_protocol: PROTOCOL_PATH,
    validation_research: VALIDATION_RESEARCH_PATH,
    roadmap: ROADMAP_PATH,
  };
  for (const [name, expectedPath] of Object.entries(contractPaths)) {
    const actualPath = field(contractBlock, name);
    if (resolve(REPO_ROOT, actualPath) !== expectedPath) {
      fail(`contract points to ${actualPath}, not ${relative(expectedPath)}`);
    }
  }

  process.stdout.write(
    `Product direction is current through ${reviewByText}: ${relative(reviewPath)} ` +
      `(${independentContexts} independent contexts, ${release}).\n`,
  );
}

function countFiles(root, predicate) {
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) count += countFiles(path, predicate);
    else if (entry.isFile() && predicate(path)) count += 1;
  }
  return count;
}

function git(...args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function runPacket() {
  runCheck();
  const release = currentRelease();
  const head = git("rev-parse", "HEAD");
  const recent = git("log", "-12", "--date=short", "--pretty=format:%h %ad %s");
  const tags = git("tag", "--sort=-version:refname", "--list", "v*")
    .split("\n")
    .slice(0, 12)
    .join(", ");
  const pages = countFiles(resolve(APP_ROOT, "src/app"), (path) => path.endsWith("/page.tsx"));
  const routes = countFiles(resolve(APP_ROOT, "src/app/api"), (path) => path.endsWith("/route.ts"));
  const migrations = countFiles(
    resolve(APP_ROOT, "supabase/migrations"),
    (path) => path.endsWith(".sql"),
  );
  const tests = countFiles(resolve(APP_ROOT, "src/test"), (path) => /\.test\.tsx?$/.test(path));
  const latestReview = relative(latestReviewPath());
  const contract = readFileSync(CONTRACT_PATH, "utf8").trim();
  const roadmap = readFileSync(ROADMAP_PATH, "utf8").trim();
  const matrix = readFileSync(MATRIX_PATH, "utf8").trim();

  process.stdout.write(`\n# Fresh-context OpenPlan product-direction review packet

You are an independent reviewer with no obligation to preserve prior agents' scope or decisions.
Act as a planner contributing the ultimate free planning operating system to the profession, and
as the principal engineer responsible for making the recommendation executable and honest.

## Current snapshot

- Generated: ${new Date().toISOString()}
- Release: ${release}
- Commit: ${head}
- Planner pages: ${pages}
- API routes: ${routes}
- Migrations: ${migrations}
- Vitest files: ${tests}
- Latest direction record: ${latestReview}
- Recent tags: ${tags}

## Recent commits

\`\`\`text
${recent}
\`\`\`

## Your task

Review the repository, live product, releases, CI, documentation, current and archived plans,
Claude and Codex histories, and memories. Start at the 30,000-foot destination before choosing a
module. Explicitly answer all ten questions in
\`docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md\` from every required perspective. Identify
stale rules and simple high-leverage omissions. Preserve disagreement and state what evidence
would falsify each major recommendation. Do not reduce scope because work or model runtime is
large. Do not invent coverage, validation, or data.

Produce an independent report before reading another reviewer's conclusion.

## Binding v1 contract

${contract}

## Current roadmap

${roadmap}

## Current capability matrix

${matrix}
`);
}

const argument = process.argv[2] ?? "--check";
if (argument === "--check") runCheck();
else if (argument === "--packet") runPacket();
else fail(`unknown argument ${argument}; use --check or --packet`);
