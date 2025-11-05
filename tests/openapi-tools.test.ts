import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { OpenApiTools } from '../src/tools/openapi-tools';

const specsDir = path.join(__dirname, 'fixtures');

const createTools = (options: Partial<ConstructorParameters<typeof OpenApiTools>[0]> = {}) =>
  new OpenApiTools({ specsDir, ...options });

test('searchApis indexes GET operations by default', async () => {
  const tools = createTools();
  const result: any = await tools.searchApis({ query: 'pets' });

  assert.equal(result.totalOperations, 3);
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

test('runApi does not throw validation error when all required query parameters are present', async () => {
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
    assert.ok(!error.message.includes('Missing required query parameter'),
      `Expected network/other error but got validation error: ${error.message}`);
  }
});

test('runApi does not throw validation error when optional query parameters are missing', async () => {
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
    assert.ok(!error.message.includes('Missing required query parameter'),
      `Expected network/other error but got validation error: ${error.message}`);
  }
});

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
