// A stand-in for Claude Code in map package tests. It never calls a model.
// FAKE_CLAUDE_MODE picks the behavior; it writes what it was given to
// openplan_fake_launch.json in its working directory for the test to inspect.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "success";
if (args[0] === "--version") { process.stdout.write("2.1.296 (Claude Code)\n"); process.exit(0); }
if (args[0] === "auth") {
  process.stdout.write(JSON.stringify(mode === "signed-out" ? { loggedIn: false }
    : { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max", email: "synthetic@example.test" }));
  process.exit(mode === "signed-out" ? 1 : 0);
}

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const model = args[args.indexOf("--model") + 1];
let prompt = "";
process.stdin.on("data", chunk => { prompt += chunk; });
process.stdin.on("end", () => {
  writeFileSync(join(process.cwd(), "openplan_fake_launch.json"), JSON.stringify({ args, prompt,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FAKE_") && !key.startsWith("NODE_"))) }));
  send({ type: "system", subtype: "init", model: mode === "wrong-init-model" ? "claude-opus-5-5" : model, apiKeySource: mode === "api-key" ? "ANTHROPIC_API_KEY" : "none", session_id: "synthetic-session" });
  if (mode === "wait") { setInterval(() => send({ type: "assistant", message: { content: [{ type: "text", text: "Still working" }] } }), 20); return; }
  send({ type: "assistant", message: { content: [
    { type: "tool_use", name: "Bash", input: { command: "python3 kit/tgis.py render gis", description: "Rendering the figures" } },
    { type: "tool_use", name: "WebFetch", input: { url: "https://tigerweb.geo.census.gov/arcgis/rest/services?token=SECRET" } },
  ] } });
  const build = join(process.cwd(), "gis", "build");
  const folder = join(build, "synthetic_maps_20261010");
  for (const sub of ["qa", "spec", join("maps", "png")]) mkdirSync(join(folder, sub), { recursive: true });
  writeFileSync(join(folder, "qa", "qa_report.json"), JSON.stringify({ checks: 40, passed: 38, failed: 0, notes: 2, items: [] }));
  // The shape the kit writes into a built package (scripts/tgis/review.py), seen in a real package on 2026-10-01.
  writeFileSync(join(folder, "qa", "review.json"), JSON.stringify({ gates: [
    { gate: "data", what: "Sources checked", status: "passed", reviewer: "", date: "", note: "" },
    { gate: "cartography", what: "Figures reviewed", status: "pending", reviewer: "", date: "", note: "" },
    { gate: "Bad Gate", status: "x" },
  ], blockers: [], figures: [], release_ready: false }));
  writeFileSync(join(folder, "spec", "map_package.json"), JSON.stringify({ project: {}, atlases: [], maps: [
    { id: "fig01_study_area", figure: "Figure 1", title: "Study Area", alt: "The study area." },
    { id: "fig02_crashes", figure: "Figure 2", title: "Crashes", alt: null },
    { id: "../escape", title: "Refused id" },
  ] }));
  writeFileSync(join(folder, "maps", "png", "fig01_study_area.png"), Buffer.from("synthetic-png-1"));
  writeFileSync(join(build, "synthetic_maps_20261010.zip"), Buffer.from("synthetic-zip-bytes"));
  writeFileSync(join(process.cwd(), "openplan_report.md"), "Bottom line: synthetic package built.\n");
  const usage = { [model]: { inputTokens: 10 } };
  if (mode === "extra-model") usage["claude-haiku-5-5"] = { inputTokens: 1 };
  send({ type: "result", subtype: mode === "max-turns" ? "error_max_turns" : "success", is_error: mode === "max-turns", session_id: "synthetic-session",
    num_turns: 12, duration_ms: 5000, modelUsage: usage,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } });
  process.exit(0);
});
