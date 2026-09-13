// Acceptance instrumentation tests. Provider fixtures here are not live model evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { observeAcceptanceFetch, type AcceptanceTrace } from '../../scripts/lib/agent-model-transport.mjs';

const trace = (): AcceptanceTrace => ({ modelRequests: 0, receipts: [], reads: [] });
const services = { rpcOrigin: 'https://rpc.invalid', graphOrigin: 'https://graph.invalid' };
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

test('acceptance observer delivers an unread body over HTTP and preserves the response', async t => {
  let received: unknown;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received = JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x07' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const rpcOrigin = `http://127.0.0.1:${address.port}`, record = trace();
  const observed = observeAcceptanceFetch(fetch, { ...services, rpcOrigin }, record);
  const body = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ data: '0x1234' }, '0x77'] };
  const response = await observed(new Request(rpcOrigin, post(body)));
  assert.deepEqual(received, body);
  assert.equal(response.bodyUsed, false);
  assert.equal((await response.json()).result, '0x07');
  assert.deepEqual(record, { modelRequests: 0, receipts: [], reads: [{ kind: 'rpc', block: '0x77', httpStatus: 200 }] });
});

test('acceptance observer records provider provenance while preserving the SDK response', async () => {
  const record = trace();
  const body = { id: 'msg_fixture', model: 'fixture', stop_reason: 'tool_use', usage: { input_tokens: 123, output_tokens: 45 },
    content: [{ type: 'tool_use', name: 'diagnose_intent' }, { type: 'text', text: 'fixture text' }] };
  const observed = observeAcceptanceFetch(async input => {
    assert.ok(input instanceof Request);
    assert.equal(input.bodyUsed, false);
    assert.deepEqual(await input.json(), { model: 'fixture' });
    return Response.json(body, { headers: { 'request-id': 'req_fixture' } });
  }, services, record);
  assert.deepEqual(await (await observed('https://api.anthropic.com/v1/messages', post({ model: 'fixture' }))).json(), body);
  assert.equal(record.modelRequests, 1);
  assert.deepEqual(record.receipts, [{ messageId: 'msg_fixture', requestId: 'req_fixture', model: 'fixture', stopReason: 'tool_use',
    inputTokens: 123, outputTokens: 45, text: 'fixture text', toolNames: ['diagnose_intent'] }]);
});

test('acceptance observer counts a rejected provider request without fabricating a receipt', async () => {
  const record = trace();
  const observed = observeAcceptanceFetch(async () => Response.json({ error: { type: 'authentication_error' } }, { status: 401 }), services, record);
  assert.equal((await observed('https://api.anthropic.com/v1/messages', post({ model: 'fixture' }))).status, 401);
  assert.equal(record.modelRequests, 1);
  assert.deepEqual(record.receipts, []);
  assert.deepEqual(record.reads, [{ kind: 'anthropic', block: undefined, httpStatus: 401 }]);
});

test('acceptance observer rejects unknown services and writes before sending HTTP', async () => {
  let sends = 0;
  const observed = observeAcceptanceFetch(async () => { sends++; return Response.json({}); }, services, trace());
  await assert.rejects(observed('https://unrelated.invalid', post({})), /Unexpected outbound service/);
  await assert.rejects(observed(services.rpcOrigin, post({ method: 'eth_sendRawTransaction' })), /Only contract reads are allowed/);
  await assert.rejects(observed(services.graphOrigin, post({ query: 'mutation changeSomething' })), /Only Graph read queries are allowed/);
  await assert.rejects(observed('https://api.anthropic.com/v1/files', post({})), /\/v1\/messages/);
  assert.equal(sends, 0);
});
