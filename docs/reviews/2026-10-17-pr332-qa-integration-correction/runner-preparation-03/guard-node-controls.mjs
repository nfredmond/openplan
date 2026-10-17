// SOURCE ONLY. One future builtin-only Node child, nine named case executions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const publicRoot = path.dirname(new URL(import.meta.url).pathname);
const privateRoot = '/home/nathaniel/.local/state/openplan/pr332-qa-integration-correction-20261017/runner-preparation-03';
const output = path.join(privateRoot, 'guard-execution-01');
const plan = JSON.parse(readFileSync(path.join(publicRoot, 'GUARD_SOURCE.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = readFileSync(plan.node.baseline);
const working = path.join(output, 'working-node.mjs');
const rows = [];
let primary = null;
const cleanup = [];
let restoredSHA256 = null;
const deadline = Date.now() + 27000;

async function waitForPhase(name) {
  const file = path.join(output, `go-${name}`);
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error('guard_node_phase_deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!readFileSync(file).equals(Buffer.from('1'))) throw new Error('guard_phase_marker_changed');
}

function acknowledge(name) {
  const file = path.join(output, `ack-${name}`);
  writeFileSync(file, '1', { flag: 'wx', mode: 0o600 });
  if (!readFileSync(file).equals(Buffer.from('1'))) throw new Error('guard_ack_readback_mismatch');
}

function observedError(operation) {
  try { operation(); } catch (error) { return { name: error.name, message: error.message }; }
  return null;
}

function nWrite(module, root, evidence) {
  const file = path.join(root, 'writer');
  const fd = openSync(file, 'wx', 0o600);
  const calls = [];
  let returned;
  try {
    module.setGuardWriter((handle, data, offset) => {
      const count = writeSync(handle, data, offset, 1);
      calls.push(count);
      return count;
    });
    returned = module.writeAll(fd, Buffer.from('12345678'));
  } finally {
    module.setGuardWriter(writeSync);
    closeSync(fd);
  }
  const actual = readFileSync(file);
  Object.assign(evidence, { actualBytes: actual.toString('hex'), calls, returned });
  assert.ok(actual.equals(Buffer.from('12345678')) && JSON.stringify(calls) === JSON.stringify(Array(8).fill(1)) && returned === 8, 'N-WRITE.actual-eight');
  const refusals = {};
  for (const [label, value] of [['zero', 0], ['string', 'x']]) {
    let counter = 0;
    try {
      module.setGuardWriter(() => {
        counter += 1;
        if (counter >= 3) throw new Error('local_callback_limit');
        return value;
      });
      refusals[label] = observedError(() => module.writeAll(-1, Buffer.from('12345678')));
    } finally { module.setGuardWriter(writeSync); }
  }
  evidence.refusals = refusals;
  assert.ok(JSON.stringify(refusals.zero) === JSON.stringify({ name: 'Error', message: 'report_invalid_actual_write_count' }), 'N-WRITE.zero-refusal');
  assert.ok(JSON.stringify(refusals.string) === JSON.stringify({ name: 'Error', message: 'report_invalid_actual_write_count' }), 'N-WRITE.string-refusal');
}

function nReadback(module, root, evidence) {
  const file = path.join(root, 'readback');
  writeFileSync(file, '12345678', { flag: 'wx', mode: 0o600 });
  const hash = sha(Buffer.from('12345678'));
  const positive = module.saved(file, 8, hash);
  writeFileSync(file, '1234567X');
  const refusal = observedError(() => module.saved(file, 8, hash));
  Object.assign(evidence, { positiveBytes: positive.bytes, actualBytes: readFileSync(file).toString('hex'), refusal });
  assert.ok(positive.bytes === 8 && readFileSync(file).equals(Buffer.from('1234567X')), 'N-READBACK.fixture-bytes');
  assert.ok(JSON.stringify(refusal) === JSON.stringify({ name: 'Error', message: 'report_saved_length_or_hash_mismatch' }), 'N-READBACK.hash-refusal');
}

const cases = { 'N-WRITE': nWrite, 'N-READBACK': nReadback };
try {
  for (const step of plan.node.steps) {
    if (step.id === 'baseline') await waitForPhase('baseline');
    if (step.id === 'N-W1') await waitForPhase('omissions');
    if (step.id === 'restored') await waitForPhase('restored');
    const bytes = readFileSync(step.source);
    if (sha(bytes) !== step.sha256) throw new Error('guard_source_changed');
    writeFileSync(working, bytes, { mode: 0o600 });
    if (!readFileSync(working).equals(bytes)) throw new Error('guard_working_copy_mismatch');
    try {
      const module = await import(`${pathToFileURL(working).href}?selection=${step.id}`);
      for (const id of step.cases) {
        const root = path.join(output, `${step.id}-${id}`);
        mkdirSync(root, { mode: 0o700 });
        const evidence = {};
        let error = null;
        try { cases[id](module, root, evidence); }
        catch (caught) { error = { name: caught.name, code: caught.code, message: caught.message, stack: caught.stack, actual: caught.actual, expected: caught.expected }; }
        rows.push({ variant: step.id, case: id, passed: error === null, error, evidence });
        const partial = Buffer.from(`${JSON.stringify({ rows, primary, cleanup })}\n`);
        const partialPath = path.join(output, 'node-partial.json');
        writeFileSync(partialPath, partial, { mode: 0o600 });
        if (!readFileSync(partialPath).equals(partial)) throw new Error('guard_node_partial_readback_mismatch');
        if (['harmless', 'baseline', 'restored'].includes(step.id) && error !== null) throw new Error('guard_node_control_failed');
      }
    } finally {
      writeFileSync(working, baseline);
      if (!readFileSync(working).equals(baseline)) throw new Error('guard_node_restore_mismatch');
    }
    if (step.id === 'harmless' || step.id === 'baseline' || step.id === 'restored') acknowledge(step.id);
    if (step.id === 'N-R1') acknowledge('omissions');
  }
} catch (error) {
  primary = { name: error.name, message: error.message, stack: error.stack };
} finally {
  try { writeFileSync(working, baseline); } catch (error) { cleanup.push({ step: 'restore', name: error.name, message: error.message }); }
  try { if (!readFileSync(working).equals(baseline)) throw new Error('guard_node_final_restore_mismatch'); }
  catch (error) { cleanup.push({ step: 'restore-readback', name: error.name, message: error.message }); }
  try { restoredSHA256 = sha(readFileSync(working)); }
  catch (error) { cleanup.push({ step: 'restore-hash', name: error.name, message: error.message }); }
  const result = Buffer.from(`${JSON.stringify({ rows, primary, cleanup, restoredSHA256 })}\n`);
  const file = path.join(output, 'node-results.json');
  writeFileSync(file, result, { flag: 'wx', mode: 0o600 });
  if (!readFileSync(file).equals(result)) throw new Error('guard_node_result_readback_mismatch');
}
if (primary || cleanup.length) process.exitCode = 1;
