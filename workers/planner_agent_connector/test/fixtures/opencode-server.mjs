import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const mode = process.env.MODE;
const receipt = { pid: process.pid, requests: [], terminated: false };
const save = () => writeFileSync(process.env.RECEIPT_PATH, JSON.stringify(receipt));
save();
if (mode === "ignoreTerm") process.on("SIGTERM", () => { receipt.terminated = true; save(); });
if (mode === "earlyExit") process.exit(7);
if (mode === "noBanner") setInterval(() => {}, 1000);
else {
  const server = createServer(async (request, response) => {
    receipt.requests.push({ path: request.url, method: request.method,
      authenticated: request.headers.authorization === `Basic ${Buffer.from(`openplan:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}` });
    save();
    if (!receipt.requests.at(-1).authenticated || mode === "rejectAuth") { response.writeHead(401); response.end(); return; }
    if (request.url === "/global/health") {
      if (mode === "emptyHealth") { response.writeHead(204); response.end(); return; }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ healthy: mode !== "unhealthy", version: mode === "wrongVersion" ? "0.0.0" : "1.18.30" }));
      if (mode === "laterExit") setTimeout(() => process.exit(7), 50);
      return;
    }
    if (mode === "stall") return;
    if (mode === "redirect" && request.url !== "/redirect-target") {
      response.writeHead(302, { location: "/redirect-target" }); response.end(); return;
    }
    if (mode === "wrongType") { response.setHeader("content-type", "text/plain"); response.end('{}'); return; }
    if (mode === "errorStatus") response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    if (mode === "badJson") { response.end('PRIVATE_INVALID_NATIVE_JSON'); return; }
    if (mode === "oversized") { response.end(JSON.stringify({ value: "x".repeat(256001) })); return; }
    let body = ""; for await (const chunk of request) body += chunk;
    response.end(JSON.stringify({ id: "ses_synthetic", received: body ? JSON.parse(body) : null }));
  });
  server.listen(0, "127.0.0.1", () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const announced = mode === "wrongOrigin" ? "http://127.0.0.2:1234" :
      mode === "invalidPort" ? "http://127.0.0.1:65536" : mode === "zeroPort" ? "http://127.0.0.1:0" : origin;
    const line = `opencode server listening on ${announced}\n`;
    if (mode === "duplicateBanner") process.stdout.write(line.repeat(2));
    else if (mode === "splitBanner") {
      process.stdout.write(line.slice(0, 12)); setTimeout(() => process.stdout.write(line.slice(12)), 10);
    } else process.stdout.write(line);
    if (mode === "stdoutOverflow") process.stdout.write("x".repeat(65537));
    if (mode === "stderrOverflow") process.stderr.write("PRIVATE".repeat(10000));
  });
}
