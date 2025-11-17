/**
 * Test script for Streamable HTTP MCP transport
 * Tests the implementation according to MCP specification 2025-06-18
 */

const axios = require('axios');
const EventSource = require('eventsource');

const BASE_URL = 'http://localhost:3000';
const MCP_ENDPOINT = `${BASE_URL}/mcp`;

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, message) {
  const status = passed ? '✓' : '✗';
  console.log(`${status} ${name}: ${message}`);
  results.tests.push({ name, passed, message });
  if (passed) results.passed++;
  else results.failed++;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testProtocolVersionHeader() {
  console.log('\n--- Test 1: Protocol Version Header ---');
  
  try {
    // Test without protocol version header (should default to 2025-03-26)
    const response1 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      validateStatus: () => true
    });

    const sessionId1 = response1.headers['mcp-session-id'];
    logTest(
      'Initialize without protocol header',
      sessionId1 !== undefined,
      sessionId1 ? `Session created: ${sessionId1.substring(0, 8)}...` : 'No session ID returned'
    );

    // Test with protocol version header
    const response2 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18'
      },
      validateStatus: () => true
    });

    const sessionId2 = response2.headers['mcp-session-id'];
    logTest(
      'Initialize with protocol header',
      sessionId2 !== undefined && response2.status === 200,
      sessionId2 ? `Session created: ${sessionId2.substring(0, 8)}...` : 'Failed'
    );

    // Test with invalid protocol version
    const response3 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 3,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': 'invalid-version'
      },
      validateStatus: () => true
    });

    logTest(
      'Invalid protocol version',
      response3.status === 400,
      `Correctly rejected with status ${response3.status}`
    );

    return sessionId2;
  } catch (error) {
    logTest('Protocol version tests', false, error.message);
    return null;
  }
}

async function testSessionManagement(sessionId) {
  console.log('\n--- Test 2: Session Management ---');
  
  try {
    // Test request with session ID
    const response1 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
      params: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': sessionId
      },
      validateStatus: () => true
    });

    logTest(
      'Request with valid session',
      response1.status === 200,
      `Status: ${response1.status}`
    );

    // Test request without session ID (should fail for non-initialize requests)
    const response2 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/list',
      params: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18'
      },
      validateStatus: () => true
    });

    logTest(
      'Request without session',
      response2.status === 404,
      `Correctly rejected with status ${response2.status}`
    );

    // Test request with invalid session ID
    const response3 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/list',
      params: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': 'invalid-session-id'
      },
      validateStatus: () => true
    });

    logTest(
      'Request with invalid session',
      response3.status === 404,
      `Correctly rejected with status ${response3.status}`
    );

    return true;
  } catch (error) {
    logTest('Session management tests', false, error.message);
    return false;
  }
}

async function testSSEResponse(sessionId) {
  console.log('\n--- Test 3: SSE Response (POST with text/event-stream Accept) ---');
  
  try {
    const response = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 7,
      method: 'ping',
      params: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': sessionId
      },
      validateStatus: () => true,
      responseType: 'text'
    });

    const isSSE = response.headers['content-type']?.includes('text/event-stream');
    logTest(
      'POST with SSE Accept header',
      isSSE && response.status === 200,
      isSSE ? 'SSE stream received' : `Content-Type: ${response.headers['content-type']}`
    );

    // Check if response contains event data
    const hasEventData = response.data?.includes('data:');
    logTest(
      'SSE format validation',
      hasEventData,
      hasEventData ? 'Valid SSE format detected' : 'No SSE data found'
    );

    return true;
  } catch (error) {
    logTest('SSE response tests', false, error.message);
    return false;
  }
}

async function testNotificationAndResponse(sessionId) {
  console.log('\n--- Test 4: Notifications and Responses ---');
  
  try {
    // Test notification (no id, should return 202)
    const response1 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': sessionId
      },
      validateStatus: () => true
    });

    logTest(
      'Notification handling',
      response1.status === 202,
      `Status: ${response1.status}`
    );

    // Test response (should return 202)
    const response2 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 8,
      result: { message: 'test response' }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': sessionId
      },
      validateStatus: () => true
    });

    logTest(
      'Response handling',
      response2.status === 202,
      `Status: ${response2.status}`
    );

    return true;
  } catch (error) {
    logTest('Notification/response tests', false, error.message);
    return false;
  }
}

async function testSessionTermination(sessionId) {
  console.log('\n--- Test 5: Session Termination (DELETE) ---');

  try {
    // DELETE endpoint terminates the session
    const response1 = await axios.delete(MCP_ENDPOINT, {
      headers: {
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': sessionId
      },
      validateStatus: () => true
    });

    logTest(
      'DELETE session',
      response1.status === 200,
      `Status: ${response1.status}`
    );

    // Try to use deleted session - should get 404
    const response2 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 9,
      method: 'ping',
      params: {}
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Mcp-Session-Id': sessionId
      },
      validateStatus: () => true
    });

    logTest(
      'Request after DELETE',
      response2.status === 404,
      `Correctly rejected with status ${response2.status}`
    );

    return true;
  } catch (error) {
    logTest('Session termination tests', false, error.message);
    return false;
  }
}

async function testOriginValidation() {
  console.log('\n--- Test 6: Origin Validation ---');
  
  try {
    // Test with valid localhost origin
    const response1 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 10,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Origin': 'http://localhost:3000'
      },
      validateStatus: () => true
    });

    logTest(
      'Valid localhost Origin',
      response1.status === 200,
      `Status: ${response1.status}`
    );

    return response1.headers['mcp-session-id'];
  } catch (error) {
    logTest('Origin validation tests', false, error.message);
    return null;
  }
}

async function testInvalidRequests() {
  console.log('\n--- Test 7: Invalid Requests ---');

  try {
    // Test without Accept header (axios adds default Accept header, so we use transformRequest to remove it)
    const response1 = await axios.post(MCP_ENDPOINT, {
      jsonrpc: '2.0',
      id: 11,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'Accept': '' // Explicitly set Accept to empty to override axios default
      },
      transformRequest: [(data, headers) => {
        // Remove Accept header that axios adds by default
        delete headers.Accept;
        delete headers.accept;
        return JSON.stringify(data);
      }],
      validateStatus: () => true
    });

    logTest(
      'Request without Accept header',
      response1.status === 400,
      `Status: ${response1.status}`
    );

    // Test with invalid JSON-RPC
    const response2 = await axios.post(MCP_ENDPOINT, {
      invalid: 'request'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-06-18'
      },
      validateStatus: () => true
    });

    logTest(
      'Invalid JSON-RPC message',
      response2.status === 400,
      `Status: ${response2.status}`
    );

    return true;
  } catch (error) {
    logTest('Invalid request tests', false, error.message);
    return false;
  }
}

async function runTests() {
  console.log('=== Streamable HTTP MCP Transport Tests ===\n');
  console.log(`Testing endpoint: ${MCP_ENDPOINT}\n`);

  // Note: These tests require authentication. 
  // For real testing, you would need to set up OAuth tokens.
  console.log('⚠️  Note: These tests require authentication.');
  console.log('⚠️  Make sure the server is running and you have valid OAuth tokens.\n');

  try {
    // Run tests sequentially
    const sessionId1 = await testProtocolVersionHeader();
    
    if (sessionId1) {
      await testSessionManagement(sessionId1);
      await testSSEResponse(sessionId1);
      await testNotificationAndResponse(sessionId1);
      await testSessionTermination(sessionId1);
    }

    const sessionId2 = await testOriginValidation();
    if (sessionId2) {
      // Clean up
      await axios.delete(MCP_ENDPOINT, {
        headers: {
          'MCP-Protocol-Version': '2025-06-18',
          'Mcp-Session-Id': sessionId2
        },
        validateStatus: () => true
      });
    }

    await testInvalidRequests();

    // Print summary
    console.log('\n=== Test Summary ===');
    console.log(`Total: ${results.passed + results.failed}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    
    if (results.failed > 0) {
      console.log('\nFailed tests:');
      results.tests.filter(t => !t.passed).forEach(t => {
        console.log(`  - ${t.name}: ${t.message}`);
      });
    }

    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    process.exit(1);
  }
}

// Check if server is running
axios.get(`${BASE_URL}/health`)
  .then(() => runTests())
  .catch(error => {
    console.error('❌ Server is not running at', BASE_URL);
    console.error('   Please start the server first: npm run dev');
    process.exit(1);
  });

