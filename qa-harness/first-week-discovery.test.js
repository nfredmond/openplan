/**
 * The discovery runner's interruption contract. These checks do not launch a
 * browser or an agent. They prove that the runner distinguishes a completed
 * journey from quota exhaustion, server loss, timeout, and a missing report,
 * then preserves the old attempt when the job resumes.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  archiveAttempt,
  buildCodexArgs,
  classifyJobExecution,
  codexContractViolation,
  parseAgentSession,
  parseArgs,
  readFindings,
  RUNS_DIR,
  shouldResumeJob,
  verifyRun,
} = require('./first-week-discovery');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

function jobDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'first-week-discovery-'));
}

function writeCompletedJob(dir) {
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent', 'findings.json'), JSON.stringify({ outcomeReached: 'yes', findings: [] }));
  fs.writeFileSync(
    path.join(dir, 'agent-stdout.json'),
    JSON.stringify({ subtype: 'success', is_error: false, num_turns: 12, result: 'Finished.' }),
  );
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'completed', reason: 'The agent completed and left a findings report.' }),
  );
}

console.log('first-week discovery interruption and resume rules');

check('the actual Claude quota shape is blocked, even though it says success and exits zero', () => {
  const stdout = JSON.stringify({
    subtype: 'success',
    is_error: true,
    num_turns: 1,
    result: "You've hit your session limit · resets 11:50pm (America/Los_Angeles)",
  });
  const session = parseAgentSession(stdout);
  const result = classifyJobExecution({ processResult: { code: 0, stdout }, session, reportPresent: false });
  assert.strictEqual(result.status, 'blocked_quota');
});

check('the weekly-limit 429 returned by the live run is blocked, even though Claude exits one', () => {
  const stdout = JSON.stringify({
    subtype: 'success',
    is_error: true,
    api_error_status: 429,
    num_turns: 1,
    result: "You've hit your weekly limit · resets 1pm (America/Los_Angeles)",
  });
  const session = parseAgentSession(stdout);
  const result = classifyJobExecution({ processResult: { code: 1, stdout }, session, reportPresent: false });
  assert.strictEqual(result.status, 'blocked_quota');
});

check('product page text that mentions a rate limit is not agent quota evidence', () => {
  const stdout = JSON.stringify({
    type: 'item.completed',
    item: { type: 'mcp_tool_call', result: { text: 'Workspace AI rate limit protects operator spend.' } },
  });
  const result = classifyJobExecution({
    processResult: { code: 0, stdout },
    session: null,
    reportPresent: true,
  });
  assert.strictEqual(result.status, 'completed');
});

check('server loss is blocked instead of becoming a no-report result', () => {
  const result = classifyJobExecution({
    processResult: { code: 0, stdout: '' },
    session: { subtype: 'success', is_error: false },
    reportPresent: false,
    serverAvailableAfter: false,
  });
  assert.strictEqual(result.status, 'blocked_server');
});

check('a killed wall-clock timeout is blocked', () => {
  const result = classifyJobExecution({
    processResult: { code: null, signal: 'SIGKILL' },
    session: null,
    reportPresent: false,
  });
  assert.strictEqual(result.status, 'blocked_timeout');
});

check('a clean agent exit with no report is unfinished, not completed', () => {
  const result = classifyJobExecution({
    processResult: { code: 0 },
    session: { subtype: 'success', is_error: false },
    reportPresent: false,
  });
  assert.strictEqual(result.status, 'blocked_unfinished_report');
});

check('a clean agent exit with a report is completed', () => {
  const result = classifyJobExecution({
    processResult: { code: 0 },
    session: { subtype: 'success', is_error: false },
    reportPresent: true,
  });
  assert.strictEqual(result.status, 'completed');
});

check('resume skips a completed job and retries a blocked job', () => {
  const completed = jobDir();
  writeCompletedJob(completed);
  assert.strictEqual(shouldResumeJob(completed), false);

  const blocked = jobDir();
  fs.writeFileSync(path.join(blocked, 'execution.json'), JSON.stringify({ status: 'blocked_quota' }));
  assert.strictEqual(shouldResumeJob(blocked), true);
});

check('resuming archives the old attempt without deleting any evidence', () => {
  const dir = jobDir();
  fs.mkdirSync(path.join(dir, 'agent', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent', 'findings.json'), '{"findings":[]}');
  fs.writeFileSync(path.join(dir, 'agent', 'evidence', 'blocked.png'), 'old screenshot');
  fs.writeFileSync(path.join(dir, 'execution.json'), '{"status":"blocked_quota"}');
  const archived = archiveAttempt(dir, 'attempt-2');
  assert.ok(fs.existsSync(path.join(archived, 'agent', 'findings.json')));
  assert.ok(fs.existsSync(path.join(archived, 'agent', 'evidence', 'blocked.png')));
  assert.ok(fs.existsSync(path.join(archived, 'execution.json')));
  assert.deepStrictEqual(fs.readdirSync(dir), ['attempts']);
});

check('the summary counts a quota stop as blocked and names it as resumable', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '03-public-engagement');
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id: '03-public-engagement', title: 'Public engagement' }));
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'blocked_quota', reason: 'The agent service quota was exhausted before the journey finished.' }),
  );
  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.blocked, 1);
  assert.strictEqual(result.completed, 0);
  const summary = fs.readFileSync(result.summaryPath, 'utf8');
  assert.match(summary, /Run status: \*\*blocked_quota\*\*/);
  assert.match(summary, /unfinished and may be resumed/);
  assert.doesNotMatch(summary, /No report/);
});

check('verification repairs a recorded generic failure when stdout proves the job hit quota', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '04-safety-case');
  fs.mkdirSync(path.join(dir, 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id: '04-safety-case', title: 'Safety case' }));
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'failed', reason: 'The agent process failed with exit 1.', exitCode: 1 }),
  );
  fs.writeFileSync(
    path.join(dir, 'agent-stdout.json'),
    JSON.stringify({
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result: "You've hit your weekly limit · resets 1pm (America/Los_Angeles)",
    }),
  );
  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.blocked, 1);
  assert.strictEqual(result.failed, 0);
  assert.match(fs.readFileSync(result.summaryPath, 'utf8'), /blocked_quota/);
});

check('verification repairs a false recorded quota when only browser page text contains the phrase', () => {
  const runRoot = jobDir();
  const dir = path.join(runRoot, '03-public-engagement');
  writeCompletedJob(dir);
  fs.writeFileSync(
    path.join(dir, 'execution.json'),
    JSON.stringify({ status: 'blocked_quota', reason: 'quota', exitCode: 0, backend: 'codex' }),
  );
  fs.writeFileSync(
    path.join(dir, 'agent-stdout.json'),
    `${JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', result: 'AI rate limit' } })}\n`,
  );
  const result = verifyRun(runRoot, 'http://localhost:3200');
  assert.strictEqual(result.completed, 1);
  assert.strictEqual(result.blocked, 0);
});

check('a one-layer JSON string is decoded, while a non-report string stays unfinished', () => {
  const wrappedDir = jobDir();
  fs.mkdirSync(wrappedDir, { recursive: true });
  const report = { job: 'x', outcomeReached: 'partly', whatIDid: 'Worked.', findings: [] };
  fs.writeFileSync(path.join(wrappedDir, 'findings.json'), JSON.stringify(JSON.stringify(report)));
  assert.deepStrictEqual(readFindings(wrappedDir), report);

  const invalidDir = jobDir();
  fs.writeFileSync(path.join(invalidDir, 'findings.json'), JSON.stringify('not a report'));
  assert.strictEqual(readFindings(invalidDir), null);
});

check('the command line accepts a resume directory', () => {
  assert.deepStrictEqual(parseArgs(['--resume', 'first-week-runs/a', '--job=04-safety-case']), {
    jobs: ['04-safety-case'],
    list: false,
    verifyOnly: null,
    resume: 'first-week-runs/a',
  });
});

check('new run directories live outside the repository', () => {
  assert.ok(
    !RUNS_DIR.startsWith(`${path.resolve(__dirname)}${path.sep}`),
    `fresh agents would work inside the repository at ${RUNS_DIR}`,
  );
});

check('the Codex fallback isolates user context and exposes the browser MCP', () => {
  const args = buildCodexArgs({ agentDir: '/tmp/agent', browserDir: '/tmp/browser' });
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('--approve-for-me'));
  assert.ok(!args.includes('--sandbox'), '--approve-for-me and --sandbox are mutually exclusive in this Codex CLI');
  assert.ok(args.some((arg) => arg === 'mcp_servers.browser.command="npx"'));
  assert.ok(args.some((arg) => arg.includes('@playwright/mcp@0.0.79')));
});

check('a Codex journey that uses shell or web search violates the fresh-browser contract', () => {
  const command = JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'rg routes' } });
  const search = JSON.stringify({ type: 'item.started', item: { type: 'web_search', query: 'OpenPlan routes' } });
  const browser = JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'browser' } });
  assert.match(codexContractViolation(command), /shell command/);
  assert.match(codexContractViolation(search), /web search/);
  assert.strictEqual(codexContractViolation(browser), null);
});

console.log(failures === 0 ? '\nInterruption states are durable and resumable.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
