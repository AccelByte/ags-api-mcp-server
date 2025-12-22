import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCPServer } from '../src/mcp-server';
import { createMockRequest, createMockResponse } from './helpers/mock-express';

test('handleRequest rejects requests without JSON-RPC 2.0', async () => {
  const server = new MCPServer();
  const req = createMockRequest({
    body: { jsonrpc: '1.0', id: 'abc123', method: 'ping' }
  });
  const res = createMockResponse();

  await server.handleRequest(req as any, res as any);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonPayload, {
    jsonrpc: '2.0',
    id: 'abc123',
    error: {
      code: -32600,
      message: 'Invalid Request'
    }
  });
});

test('tools/list returns both explicit schemas and generated defaults', async () => {
  const server = new MCPServer();
  server.registerTool('custom-tool', async () => 'done', {
    name: 'custom-tool',
    description: 'Custom tool description',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string' }
      },
      required: ['input']
    }
  });
  server.registerTool('get_token_info', async () => 'info');

  const req = createMockRequest({
    body: { jsonrpc: '2.0', id: 'list-1', method: 'tools/list' }
  });
  const res = createMockResponse();

  await server.handleRequest(req as any, res as any);

  const payload = res.jsonPayload;
  assert.ok(payload?.result?.tools);
  const tools = payload.result.tools;
  assert.equal(tools.length, 2);

  const custom = tools.find((tool: any) => tool.name === 'custom-tool');
  assert.ok(custom);
  assert.equal(custom.description, 'Custom tool description');
  assert.deepEqual(custom.inputSchema.required, ['input']);

  const defaultSchema = tools.find((tool: any) => tool.name === 'get_token_info');
  assert.ok(defaultSchema);
  assert.equal(
    defaultSchema.description,
    'Get information about the authenticated token and user from the access token. ' +
      'Returns the namespace that should be used as the implicit default namespace ' +
      'for all subsequent API requests when a namespace parameter is not explicitly specified.'
  );
  assert.equal(defaultSchema.inputSchema.type, 'object');
});

test(
  'tools/call passes user context to handlers and formats object results as JSON text',
  async () => {
    const server = new MCPServer();
    let receivedUserContext: any = null;
    server.registerTool('echo', async (args: any, userContext: any) => {
      receivedUserContext = userContext;
      return { echoed: args, user: userContext?.sub };
    });

    const req = createMockRequest({
      headers: { Authorization: 'Bearer token-123' },
      user: {
        sub: 'user-42',
        client_id: 'client-7',
        scope: 'read write',
        namespace: 'test-ns'
      },
      body: {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            value: 'ping'
          }
        }
      }
    });
    const res = createMockResponse();

    await server.handleRequest(req as any, res as any);

    const content = res.jsonPayload?.result?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0].type, 'text');
    const parsed = JSON.parse(content[0].text);
    assert.deepEqual(parsed, {
      echoed: { value: 'ping' },
      user: 'user-42'
    });

    assert.ok(receivedUserContext);
    assert.equal(receivedUserContext?.accessToken, 'token-123');
    assert.equal(receivedUserContext?.sub, 'user-42');
    assert.equal(receivedUserContext?.client_id, 'client-7');
    assert.equal(receivedUserContext?.namespace, 'test-ns');
  }
);

test('tools/call returns structured errors when tool is missing or throws', async () => {
  const server = new MCPServer();
  server.registerTool('fails', async () => {
    throw new Error('boom');
  });

  const missingReq = createMockRequest({
    body: {
      jsonrpc: '2.0',
      id: 'missing',
      method: 'tools/call',
      params: { name: 'unknown' }
    }
  });
  const missingRes = createMockResponse();
  await server.handleRequest(missingReq as any, missingRes as any);
  assert.equal(missingRes.jsonPayload.error.code, -32601);
  assert.equal(missingRes.jsonPayload.error.message, "Tool 'unknown' not found");

  const failingReq = createMockRequest({
    body: {
      jsonrpc: '2.0',
      id: 'failure',
      method: 'tools/call',
      params: { name: 'fails', arguments: {} }
    }
  });
  const failingRes = createMockResponse();
  await server.handleRequest(failingReq as any, failingRes as any);

  assert.equal(failingRes.jsonPayload.error.code, -32603);
  assert.ok(
    failingRes.jsonPayload.error.message.startsWith('Tool execution failed: Error: boom'),
    'expected error message mentioning original failure'
  );
});
