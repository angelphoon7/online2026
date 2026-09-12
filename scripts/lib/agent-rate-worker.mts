// Acceptance worker: invokes the actual Agent routes; receives only synthetic invalid inputs.
import { createServer } from 'node:http';
import { POST } from '../../app/api/agent/ask/route.js';
import { GET } from '../../app/api/agent/diagnose/[hash]/route.js';

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const request = new Request('http://worker.local' + incoming.url, { method: incoming.method, headers, ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const response = incoming.url === '/api/agent/ask'
      ? await POST(request)
      : await GET(request, { params: Promise.resolve({ hash: 'rate-limit-check' }) });
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.setHeader('X-Test-Worker', String(process.pid));
    outgoing.writeHead(response.status); outgoing.end(await response.text());
  } catch { outgoing.writeHead(500); outgoing.end('Acceptance worker failed'); }
});
server.listen(0, '127.0.0.1', () => { process.send?.({ port: (server.address() as { port: number }).port, pid: process.pid }); });
process.on('disconnect', () => { server.close(); process.exit(0); });
