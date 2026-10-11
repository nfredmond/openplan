import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const workerNames = Object.freeze([
  "document-exports", "engagement-email", "provider-api", "translation-generation",
  "synthesis-preparation", "synthesis-execution", "contract-calculations",
]);

export function selectedWorkers(value) {
  const selected = value ? value.split(",").map(name => name.trim()) : [...workerNames];
  if (!selected.length || selected.some(name => !workerNames.includes(name)) || new Set(selected).size !== selected.length) {
    throw new Error("Select distinct supported OpenPlan workers.");
  }
  return selected;
}

// A failed queue process ends the service so the host can restart the whole set.
// Durable journals belong on the volume; restart never implies permission to retry.
export async function superviseWorkers({ names, directory, signal, graceMs = 20000, log = console.log }) {
  let stopping = false;
  let failed = false;
  let timer;
  const children = [];
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
    timer = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, graceMs);
    timer.unref();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) return 0;
    const exits = names.map(name => new Promise(resolveExit => {
      const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", resolve(directory, `${name}.ts`)], { stdio: "inherit" });
      children.push(child);
      log(`Started OpenPlan worker: ${name}`);
      child.once("error", () => { failed = true; stop(); });
      child.once("close", code => {
        if (!stopping) {
          failed = true;
          log(`OpenPlan worker stopped unexpectedly: ${name}, exit ${code}`);
          stop();
        }
        resolveExit();
      });
    }));
    await Promise.all(exits);
    return failed ? 1 : 0;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  try {
    process.exitCode = await superviseWorkers({ names: selectedWorkers(process.env.OPENPLAN_NODE_WORKERS), directory: "scripts/workers", signal: controller.signal });
  } catch {
    console.error("OpenPlan worker supervisor could not start. Check the selected workers and service configuration.");
    process.exitCode = 1;
  }
}
