// @vitest-environment node
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Execute the actual observer and entry-point bodies. Only imported infrastructure
// is replaced. The barrier reproduces directory/journal startup before worker
// signal ownership. This does not run a business queue or external provider.
function withoutImports(source: string) {
  const tree = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true);
  return tree.statements.filter(value => !ts.isImportDeclaration(value)).map(value => value.getFullText(tree)).join("\n");
}
const infrastructure = `
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
const appCommitSha = () => "a".repeat(40);
const claim = () => { process.send({ event: "claim" }); return Promise.resolve({data:[],error:null}); };
const createServiceRoleClient = () => ({rpc: name => name === "record_node_queue_process_observation"
 ? {abortSignal: async () => ({data:true,error:null})} : claim()});
const barrier = () => new Promise(resolve => {
 process.send({event:"startup"});
 process.once("message", () => resolve({recover: async () => ({unreadable:0})}));
});
const mkdir = barrier, createResponseEmailJournal = barrier;
const processResponseEmail = async () => { await claim(); return "idle"; };
const processNextEngagementReport = async () => { await claim(); return false; };
`;

async function startup(kind: string, signal: "SIGTERM" | "SIGINT") {
  const directory = await mkdtemp(path.join(tmpdir(), "openplan-observer-startup-"));
  const helper = await readFile(path.join(process.cwd(), "src/lib/ops/node-queue-observation.ts"), "utf8");
  const entry = await readFile(path.join(process.cwd(), "scripts/workers", `${kind}.ts`), "utf8");
  const source = infrastructure + withoutImports(helper) + withoutImports(entry);
  const file = path.join(directory, "worker.mjs");
  await writeFile(file, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, {mode:0o600});
  const child = fork(file, [], { execArgv: [], env: { NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "http://synthetic.invalid", NEXT_PUBLIC_SUPABASE_URL: "http://synthetic.invalid" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let claimed = false, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  child.on("message", value => {
    const event = (value as {event?:string}).event;
    if (event === "startup") ready();
    if (event === "claim") claimed = true;
  });
  const ended = new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve => child.once("exit", (code, endedSignal) => resolve({code,signal:endedSignal})));
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const deadline = (ms: number) => new Promise<null>(resolve => {timers.push(setTimeout(() => resolve(null),ms));});
  try {
    expect(await Promise.race([started.then(() => true), ended.then(() => false), deadline(2000)]), "Actual entry must reach its startup barrier").toBe(true);
    expect(child.kill(signal), "Owned startup child must receive its stop signal").toBe(true);
    let result = await Promise.race([ended, deadline(200)]);
    if (result === null) {
      // A swallowed signal must not hide behind a startup promise that never resumes.
      if (child.connected) child.send({event:"release"});
      result = await Promise.race([ended, deadline(300)]);
    }
    expect(result?.signal, "Startup signal must keep default termination before worker handlers").toBe(signal);
    expect(claimed, "Stopped startup cannot reach a later queue claim").toBe(false);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await ended; }
    await rm(directory,{recursive:true,force:true});
  }
}

describe("Node worker startup signal ownership", () => {
  for (const kind of ["document-exports", "engagement-email"]) {
    it(`preserves default stop during ${kind} startup`, async () => {
      for (const signal of ["SIGTERM", "SIGINT"] as const) await startup(kind,signal);
    });
  }
});
