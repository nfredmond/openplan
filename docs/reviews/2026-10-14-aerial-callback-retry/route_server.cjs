// Adapt owned loopback requests to the actual Next route for a bounded API proof.
const http = require('node:http');
const { NextRequest } = require('next/server');
const { POST } = require(process.env.OPENPLAN_NATIVE_ROUTE_BUNDLE);
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/callback') {
      response.writeHead(404).end(); return;
    }
    const chunks = []; let total = 0;
    for await (const chunk of request) {
      total += chunk.length;
      if (total > 1024 * 1024) throw new Error('Native callback exceeds proof budget');
      chunks.push(chunk);
    }
    const result = await POST(new NextRequest('http://127.0.0.1/callback', {
      method: 'POST', headers: request.headers, body: Buffer.concat(chunks),
    }));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error.name }));
  }
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ port: server.address().port })+'\n');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
