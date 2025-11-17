import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

test('HTTP server error handling - port conflict is detected', async () => {
  // Create a server on port to block it
  const blockingServer = http.createServer();

  await new Promise<void>((resolve, reject) => {
    blockingServer.on('error', reject);
    blockingServer.listen(0, () => resolve()); // Use port 0 to get a random available port
  });

  const blockedPort = (blockingServer.address() as any).port;

  // Now try to create another server on the same port
  const testServer = http.createServer();

  let errorCaught = false;
  let errorCode = '';

  testServer.on('error', (error: any) => {
    errorCaught = true;
    errorCode = error.code;
  });

  testServer.listen(blockedPort);

  // Wait a bit for the error to be emitted
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify error was caught
  assert.equal(errorCaught, true, 'Error event should have been triggered');
  assert.equal(errorCode, 'EADDRINUSE', 'Error code should be EADDRINUSE');

  // Cleanup
  blockingServer.close();
  testServer.close();
});

test('HTTP server error handler attached before listen catches port conflicts', async () => {
  // Create blocking server
  const blockingServer = http.createServer();

  await new Promise<void>((resolve, reject) => {
    blockingServer.on('error', reject);
    blockingServer.listen(0, () => resolve());
  });

  const blockedPort = (blockingServer.address() as any).port;

  // Create test server with error handler BEFORE listen
  const testServer = http.createServer();

  let errorCaught = false;
  let errorMessage = '';

  // Attach error handler BEFORE calling listen (the correct pattern)
  testServer.on('error', (error: any) => {
    errorCaught = true;
    errorMessage = error.code === 'EADDRINUSE'
      ? `Port ${blockedPort} is already in use`
      : error.message;
  });

  // Now call listen
  testServer.listen(blockedPort);

  // Wait for async error
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify
  assert.equal(errorCaught, true);
  assert.ok(errorMessage.includes('already in use'));

  // Cleanup
  blockingServer.close();
  testServer.close();
});

test('HTTP server listening event fires when port is available', async () => {
  const testServer = http.createServer();

  let listeningFired = false;
  let errorFired = false;

  testServer.on('error', () => {
    errorFired = true;
  });

  testServer.on('listening', () => {
    listeningFired = true;
  });

  testServer.listen(0); // Port 0 = use any available port

  // Wait for event
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(listeningFired, true, 'Listening event should fire when port is available');
  assert.equal(errorFired, false, 'Error event should not fire when port is available');

  testServer.close();
});
