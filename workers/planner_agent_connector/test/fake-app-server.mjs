import { createInterface } from "node:readline";
const mode = process.argv[2];
let receivedReply, inspection;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    if (mode === "malformed") return process.stdout.write("{not json}\n");
    if (mode === "unfinished") { process.stdout.write('{"id":'); return process.exit(0); }
    if (mode === "empty-response") return send({ id: request.id });
    if (mode === "wrong-id") return send({ id: 999, result: {} });
    if (mode === "oversized") return process.stdout.write("x".repeat(600_000));
    if (mode === "hang") return;
    return send({ id: request.id, result: { version: "fixture" } });
  }
  if (request.method === "turn/start") {
    if (mode === "lost-final") { send({ id: request.id, result: { turn: { id: "turn" } } }); return process.exit(0); }
    if (mode === "tool") {
      send({ id: "tool-1", method: "item/tool/call", params: { tool: "read_selected_project", threadId: "thread", turnId: "turn", arguments: {} } });
    }
    if (mode === "approval") {
      send({ id: "permission-1", method: "item/permissions/requestApproval", params: { permissions: { network: { enabled: true } } } });
    }
    // Deliberately race the request response with the final notification.
    send({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed", items: [] } } });
    send({ id: request.id, result: { turn: { id: "turn" } } });
  }
  if (request.method === "inspect") {
    inspection = request;
    if (receivedReply) send({ id: inspection.id, result: receivedReply });
  }
  if (request.id === "permission-1" || request.id === "tool-1") {
    receivedReply = request;
    if (inspection) send({ id: inspection.id, result: receivedReply });
  }
});
