import assert from 'node:assert/strict';

export type ModelReceipt = {
  messageId: string; requestId: string | null; model: string; stopReason: string;
  inputTokens: number; outputTokens: number; text: string; toolNames: string[];
};
export type AcceptanceTrace = {
  modelRequests: number;
  receipts: ModelReceipt[];
  reads: { kind: string; block?: string; httpStatus: number }[];
};

/** Observe real traffic without consuming either the outgoing or returned body. */
export function observeAcceptanceFetch(
  upstream: typeof fetch,
  services: { rpcOrigin: string; graphOrigin: string },
  trace: AcceptanceTrace,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const isModel = url.origin === 'https://api.anthropic.com';
    assert.ok(isModel || url.origin === services.rpcOrigin || url.origin === services.graphOrigin, 'Unexpected outbound service');
    assert.equal(request.method, 'POST', 'Acceptance only sends read queries and model questions');
    // Reading request.json() here used up its body and prevented the actual HTTP send.
    const body = await request.clone().json();
    if (isModel) {
      assert.equal(url.pathname, '/v1/messages');
      trace.modelRequests++;
    } else if (url.origin === services.rpcOrigin) {
      assert.equal(body.method, 'eth_call', 'Only contract reads are allowed');
    } else {
      assert.match(body.query, /^\s*query\s/, 'Only Graph read queries are allowed');
    }
    const response = await upstream(request);
    const data = await response.clone().json();
    if (isModel && response.ok) trace.receipts.push({
      messageId: data.id, requestId: response.headers.get('request-id'), model: data.model,
      stopReason: data.stop_reason, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens,
      text: data.content.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n'),
      toolNames: data.content.filter((c: { type: string }) => c.type === 'tool_use').map((c: { name: string }) => c.name),
    });
    trace.reads.push({ kind: isModel ? 'anthropic' : url.origin === services.rpcOrigin ? 'rpc' : 'graph',
      block: body.method ? body.params[1] : data.data?._meta?.block?.number?.toString(), httpStatus: response.status });
    return response;
  };
}
