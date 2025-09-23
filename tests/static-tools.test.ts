import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StaticTools } from '../src/tools/static-tools';

const tools = new StaticTools();

test('getTokenInfo throws when user context is missing', async () => {
  await assert.rejects((tools as any).getTokenInfo(), {
    message: 'User context not available - authentication required'
  });
});

test('getTokenInfo returns derived token details from user context', async () => {
  const userContext = {
    accessToken: 'token-abc',
    sub: 'user-99',
    client_id: 'client-42',
    scope: 'read:all',
    namespace: 'catalog',
    user: {
      display_name: 'Pet Lover',
      country: 'US',
      is_comply: true,
      iss: 'issuer',
      exp: 1700000000,
      iat: 1690000000,
      jti: 'jwt-id-123'
    }
  };

  const result: any = await tools.getTokenInfo({}, userContext as any);
  assert.equal(result.message, 'Token information from authenticated token');
  assert.equal(result.tokenMetadata.length, userContext.accessToken.length);

  // Verify userContext is preserved
  assert.deepEqual(result.userContext, {
    sub: 'user-99',
    client_id: 'client-42',
    scope: 'read:all',
    namespace: 'catalog',
    user: {
      display_name: 'Pet Lover',
      country: 'US',
      is_comply: true,
      iss: 'issuer',
      exp: 1700000000,
      iat: 1690000000,
      jti: 'jwt-id-123'
    }
  });
});
