import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenApiTools } from '../src/tools/openapi-tools';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const specsDir = path.join(__dirname, 'fixtures');

const createTools = (options: Partial<ConstructorParameters<typeof OpenApiTools>[0]> = {}) =>
  new OpenApiTools({ specsDir, ...options });

test('searchApis indexes GET operations by default', async () => {
  const tools = createTools();
  const result: any = await tools.searchApis({ query: 'pets' });

  assert.equal(result.totalOperations, 2);
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
