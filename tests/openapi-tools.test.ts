import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { OpenApiTools } from '../src/tools/openapi-tools';
import { version as pkgVersion } from '../src/v2/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const specsDir = path.join(__dirname, 'fixtures');

const createTools = (options: Partial<ConstructorParameters<typeof OpenApiTools>[0]> = {}) =>
  new OpenApiTools({ specsDir, ...options });

test('searchApis indexes GET operations by default', async () => {
  const tools = createTools({ includeWriteRequests: false });
  const result: any = await tools.searchApis({ query: 'pets' });

  assert.equal(result.totalOperations, 4);
  assert.ok(result.results.length > 0);
  for (const entry of result.results) {
    assert.equal(entry.method, 'GET');
  }

  const availableSpec = result.availableSpecs[0];
  assert.equal(availableSpec.spec, 'sample-pets-api');
  assert.ok(availableSpec.servers.includes('https://api.example.com/v1'));
});

test('searchApis can include write operations when enabled', async () => {
  const tools = createTools({ includeWriteRequests: true });
  const result: any = await tools.searchApis({ method: 'post' });

  assert.equal(result.matched, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].method, 'POST');
  assert.equal(result.results[0].path, '/pets');
});

test('describeApi resolves operations via spec, method, and path aliases', async () => {
  const tools = createTools();
  const description: any = await tools.describeApi({
    spec: 'Sample Pets API',
    method: 'get',
    path: '/pets/{petId}'
  });

  assert.equal(description.apiId, 'sample-pets-api:GET:/pets/{petId}');
  assert.equal(description.summary, 'Get a pet by ID.');
  assert.equal(description.parameters[0].name, 'petId');
  assert.equal(description.parameters[0].required, true);
});

test('runApi surfaces missing path parameter errors before making a request', async () => {
  const tools = createTools();

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'get',
      path: '/pets/{petId}',
      pathParams: {}
    }),
    {
      message: "Missing path parameter 'petId' for URL template /pets/{petId}"
    }
  );
});

test('runApi throws error when required query parameter is missing', async () => {
  const tools = createTools();

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'get',
      path: '/pets/search',
      query: { age: 5 }
    }),
    {
      message: "Missing required query parameter 'species' for GET /pets/search"
    }
  );
});

test('runApi throws error when multiple required query parameters are missing', async () => {
  const tools = createTools();

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'get',
      path: '/pets/search',
      query: {}
    }),
    {
      message: "Missing required query parameter 'species' for GET /pets/search"
    }
  );
});

test('runApi throws error when all query parameters are missing', async () => {
  const tools = createTools();

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'get',
      path: '/pets/search'
    }),
    {
      message: "Missing required query parameter 'species' for GET /pets/search"
    }
  );
});

test(
  'runApi does not throw validation error when all required query parameters are present',
  async () => {
    const tools = createTools();

    // This should pass validation - we don't care if network call succeeds/fails,
    // just that validation doesn't throw an error
    try {
      await tools.runApi({
        spec: 'sample-pets-api',
        method: 'get',
        path: '/pets/search',
        query: { species: 'dog', age: 5 }
      });
      // If it succeeds, great! Validation passed
      assert.ok(true);
    } catch (error: any) {
      // If it fails, make sure it's NOT a query parameter validation error
      assert.ok(
        !error.message.includes('Missing required query parameter'),
        `Expected network/other error but got validation error: ${error.message}`
      );
    }
  }
);

test(
  'runApi does not throw validation error when optional query parameters are missing',
  async () => {
    const tools = createTools();

    // Optional 'color' parameter is not provided, should pass validation
    try {
      await tools.runApi({
        spec: 'sample-pets-api',
        method: 'get',
        path: '/pets/search',
        query: { species: 'cat', age: 3 }
      });
      // If it succeeds, great! Validation passed
      assert.ok(true);
    } catch (error: any) {
      // If it fails, make sure it's NOT a query parameter validation error
      assert.ok(
        !error.message.includes('Missing required query parameter'),
        `Expected network/other error but got validation error: ${error.message}`
      );
    }
  }
);

test('runApi passes validation with all parameters including optional ones', async () => {
  const tools = createTools();

  // All parameters provided including optional one - should pass validation
  try {
    await tools.runApi({
      spec: 'sample-pets-api',
      method: 'get',
      path: '/pets/search',
      query: { species: 'bird', age: 2, color: 'blue' }
    });
    // If it succeeds, great! Validation passed
    assert.ok(true);
  } catch (error: any) {
    // If it fails, make sure it's NOT a query parameter validation error
    assert.ok(!error.message.includes('Missing required query parameter'),
      `Expected network/other error but got validation error: ${error.message}`);
  }
});

test('runApi throws error when required request body is missing', async () => {
  const tools = createTools({ includeWriteRequests: true });

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'post',
      path: '/pets'
      // No body provided, but it's required
    }),
    {
      message: 'Missing required request body for POST /pets'
    }
  );
});

test('runApi throws error when required request body is null', async () => {
  const tools = createTools({ includeWriteRequests: true });

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'post',
      path: '/pets',
      body: null
    }),
    {
      message: 'Missing required request body for POST /pets'
    }
  );
});

test('runApi throws error when required field is missing in request body', async () => {
  const tools = createTools({ includeWriteRequests: true });

  await assert.rejects(
    tools.runApi({
      spec: 'sample-pets-api',
      method: 'post',
      path: '/pets',
      body: { tag: 'cute' } // Missing required 'name' field
    }),
    {
      message: "Missing required field 'name' in request body for POST /pets"
    }
  );
});

test(
  'runApi throws error when required field is missing even with other fields present',
  async () => {
    const tools = createTools({ includeWriteRequests: true });

    await assert.rejects(
      tools.runApi({
        spec: 'sample-pets-api',
        method: 'post',
        path: '/pets',
        body: {} // Empty body, missing required 'name' field
      }),
      {
        message: "Missing required field 'name' in request body for POST /pets"
      }
    );
  }
);

test('runApi passes validation when required body and fields are present', async () => {
  const tools = createTools({ includeWriteRequests: true });

  // This should pass validation - we don't care if network call succeeds/fails,
  // just that validation doesn't throw an error
  try {
    await tools.runApi({
      spec: 'sample-pets-api',
      method: 'post',
      path: '/pets',
      body: { name: 'Fluffy' } // Required field is present
    });
    // If it succeeds, great! Validation passed
    assert.ok(true);
  } catch (error: any) {
    // If it fails, make sure it's NOT a request body validation error
    assert.ok(
      !error.message.includes('Missing required request body') &&
      !error.message.includes('Missing required field'),
      `Expected network/other error but got validation error: ${error.message}`
    );
  }
});

test('runApi passes validation when optional fields are missing from body', async () => {
  const tools = createTools({ includeWriteRequests: true });

  // Optional 'tag' field is not provided, should pass validation
  try {
    await tools.runApi({
      spec: 'sample-pets-api',
      method: 'post',
      path: '/pets',
      body: { name: 'Buddy' } // Only required field, optional 'tag' is missing
    });
    // If it succeeds, great! Validation passed
    assert.ok(true);
  } catch (error: any) {
    // If it fails, make sure it's NOT a request body validation error
    assert.ok(
      !error.message.includes('Missing required request body') &&
      !error.message.includes('Missing required field'),
      `Expected network/other error but got validation error: ${error.message}`
    );
  }
});

test('runApi passes validation when all fields including optional ones are present', async () => {
  const tools = createTools({ includeWriteRequests: true });

  // All fields provided including optional 'tag' - should pass validation
  try {
    await tools.runApi({
      spec: 'sample-pets-api',
      method: 'post',
      path: '/pets',
      body: { name: 'Max', tag: 'friendly' } // Both required and optional fields
    });
    // If it succeeds, great! Validation passed
    assert.ok(true);
  } catch (error: any) {
    // If it fails, make sure it's NOT a request body validation error
    assert.ok(
      !error.message.includes('Missing required request body') &&
      !error.message.includes('Missing required field'),
      `Expected network/other error but got validation error: ${error.message}`
    );
  }
});

test('runApi prefers defaultServerUrl over a Swagger 2 host defined in the spec', async () => {
  const tools = createTools({ defaultServerUrl: 'https://configured-base.invalid' });

  const result: any = await tools.runApi({
    spec: 'swagger-2-host-api',
    method: 'get',
    path: '/status'
  });

  assert.match(result.error.message, /configured-base\.invalid/);
  assert.doesNotMatch(result.error.message, /spec-host\.invalid/);
});

// ---------------------------------------------------------------------------
// normalizeServerUrl — query string / fragment stripping
// ---------------------------------------------------------------------------

test('defaultServerUrl with query string is stripped during normalization, not thrown', () => {
  // Must not throw — query string is silently stripped with a warning logged
  assert.doesNotThrow(() => createTools({ defaultServerUrl: 'https://example.com/api?version=1' }));
});

test('defaultServerUrl with fragment is stripped during normalization, not thrown', () => {
  assert.doesNotThrow(() => createTools({ defaultServerUrl: 'https://example.com/api#section' }));
});

test('defaultServerUrl with query string and fragment both stripped without crashing', () => {
  assert.doesNotThrow(() => createTools({ defaultServerUrl: 'https://example.com/api?foo=bar#baz' }));
});

test('clean defaultServerUrl is normalized correctly (regression guard)', () => {
  assert.doesNotThrow(() => createTools({ defaultServerUrl: 'https://example.com/api/v1/' }));
});

// ---------------------------------------------------------------------------
// sanitizeBody — credential redaction for run-apis logging
// ---------------------------------------------------------------------------

const sanitizeBody = (tools: OpenApiTools, value: unknown) =>
  (tools as any).sanitizeBody(value);

test('sanitizeBody redacts a top-level token field', () => {
  const tools = createTools();
  const result: any = sanitizeBody(tools, { token: 'live-secret', status: 'ok' });

  assert.equal(result.token, '***REDACTED***');
  assert.equal(result.status, 'ok');
});

test('sanitizeBody redacts credential-shaped fields nested inside objects and arrays', () => {
  const tools = createTools();
  const result: any = sanitizeBody(tools, {
    data: {
      items: [{ id: 1, accessToken: 'abc' }, { id: 2, apiKey: 'xyz' }],
    },
  });

  assert.equal(result.data.items[0].accessToken, '***REDACTED***');
  assert.equal(result.data.items[0].id, 1);
  assert.equal(result.data.items[1].apiKey, '***REDACTED***');
});

test('sanitizeBody does not mutate the original object', () => {
  const tools = createTools();
  const original = { token: 'live-secret', nested: { secret: 'value' } };
  const result: any = sanitizeBody(tools, original);

  assert.notEqual(result, original);
  assert.equal(original.token, 'live-secret');
  assert.equal(original.nested.secret, 'value');
  assert.equal(result.token, '***REDACTED***');
});

test('sanitizeBody passes through primitives and null unchanged', () => {
  const tools = createTools();
  assert.equal(sanitizeBody(tools, null), null);
  assert.equal(sanitizeBody(tools, undefined), undefined);
  assert.equal(sanitizeBody(tools, 'plain string'), 'plain string');
  assert.equal(sanitizeBody(tools, 42), 42);
});

test('sanitizeBody fails closed past the recursion depth cap instead of returning raw data', () => {
  const tools = createTools();

  let deep: any = { token: 'buried-secret' };
  for (let i = 0; i < 15; i++) {
    deep = { child: deep };
  }

  const result: any = sanitizeBody(tools, deep);

  // Walk down to where the cap kicks in — the subtree must be a redaction
  // placeholder, not an object that still contains the buried token.
  let node = result;
  let sawRedactionPlaceholder = false;
  for (let i = 0; i < 16; i++) {
    if (typeof node === 'string' && node.includes('REDACTED')) {
      sawRedactionPlaceholder = true;
      break;
    }
    node = node?.child;
  }

  assert.ok(sawRedactionPlaceholder, 'expected a redaction placeholder before the buried token');
  assert.equal(JSON.stringify(result).includes('buried-secret'), false);
});

// ---------------------------------------------------------------------------
// User-Agent — identify this server to AGS on outbound run-apis requests
// ---------------------------------------------------------------------------

const captureOutboundHeaders = async (
  run: () => Promise<unknown>
): Promise<Record<string, any>> => {
  const originalAdapter = axios.defaults.adapter;
  let captured: any;

  axios.defaults.adapter = async (config: any) => {
    captured = config.headers;
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };

  try {
    await run();
  } finally {
    axios.defaults.adapter = originalAdapter;
  }

  return captured;
};

const readHeader = (headers: Record<string, any>, name: string): string =>
  String(headers?.get?.(name) ?? headers?.[name] ?? '');

test('runApi identifies this server and its version in the outbound User-Agent', async () => {
  const tools = createTools({ defaultServerUrl: 'https://configured-base.invalid' });

  const headers = await captureOutboundHeaders(() =>
    tools.runApi({ spec: 'swagger-2-host-api', method: 'get', path: '/status' })
  );

  // Asserting a leading digit is not enough -- "ags-api-mcp/0" would satisfy
  // it while the access log carries a version that was never released.
  assert.equal(readHeader(headers, 'User-Agent'), `ags-api-mcp/${pkgVersion}`);
});

// V2 opens an AsyncLocalStorage provenance scope and overrides User-Agent; V1
// (stdio, no scope) keeps the older contract where the caller wins. Both are
// pinned so a change to one cannot silently alter the other.
test('runApi leaves a caller-supplied User-Agent untouched', async () => {
  const tools = createTools({ defaultServerUrl: 'https://configured-base.invalid' });

  const headers = await captureOutboundHeaders(() =>
    tools.runApi({
      spec: 'swagger-2-host-api',
      method: 'get',
      path: '/status',
      headers: { 'User-Agent': 'caller-supplied/1.0' }
    })
  );

  assert.equal(readHeader(headers, 'User-Agent'), 'caller-supplied/1.0');
});

test('runApi never forwards caller-supplied AFS provenance, even outside a request scope', async () => {
  // The facade must never receive a playbook or context version a caller
  // asserted for itself. This holds on V1 too, where no provenance scope
  // exists and the caller otherwise controls its own headers.
  const tools = createTools({ defaultServerUrl: 'https://configured-base.invalid' });

  const headers = await captureOutboundHeaders(() =>
    tools.runApi({
      spec: 'swagger-2-host-api',
      method: 'get',
      path: '/status',
      headers: {
        'User-Agent': 'caller-supplied/1.0',
        'X-Ab-AFS-Metadata': 'playbook="forged", context="forged"'
      }
    })
  );

  assert.equal(readHeader(headers, 'User-Agent'), 'caller-supplied/1.0');
  assert.ok(
    !readHeader(headers, 'X-Ab-AFS-Metadata'),
    'caller-supplied AFS provenance must be stripped before the request goes out'
  );
});
