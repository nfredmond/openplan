import { runCodexProjectTurn } from "../codex-provider.mjs";
import { codexLaunch, codexThreadParams, codexTurnParams } from "../codex-launch.mjs";
import { startCodexSession } from "../codex-session.mjs";

const [binaryPath, providerHome, scratchPath, modelProvider, expectedAuthMode] = process.argv.slice(2);
if (expectedAuthMode) {
  const result = await runCodexProjectTurn({ binaryPath, providerHome, scratchPath, modelProvider,
    model: "fixture-model", expectedAuthMode, instructions: "Use only selected project evidence.", prompt: "Summarize the synthetic culvert review project." });
  console.log(JSON.stringify({ status: "completed", authMode: result.authMode, model: result.model, items: [{ text: result.answer }] }));
  process.exit(0);
}
const launch = await codexLaunch({ binaryPath, providerHome, scratchPath, modelProvider });
const session = startCodexSession(launch, { timeoutMs: 30_000 });
try {
  await session.request("initialize", { clientInfo: { name: "openplan_connector_fixture", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  session.notify("initialized");
  const result = await session.request("thread/start", codexThreadParams({ model: "fixture-model", instructions: "Use the selected synthetic project evidence. No other context is authorized." }));
  const turn = await session.request("turn/start", codexTurnParams({ threadId: result.thread.id, prompt: "Summarize this synthetic project: replace culvert." }));
  const final = await session.waitFor("turn/completed", (event) => event.threadId === result.thread.id && event.turn?.id === turn.turn.id);
  if (final.turn.status !== "completed" || final.turn.error) throw new Error("native_turn_failed");
  console.log(JSON.stringify({ status: final.turn.status, items: final.turn.items }));
} finally { await session.close(); }
