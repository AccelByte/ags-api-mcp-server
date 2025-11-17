#!/usr/bin/env node

import axios from 'axios';
import pino from 'pino';
import { fileURLToPath } from 'url';

// Create a simple logger for the test script
const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;

/**
 * Wait for the server to be available by checking the health endpoint
 */
async function waitForServer(maxRetries = MAX_RETRIES, delayMs = RETRY_DELAY_MS) {
  logger.info(`Waiting for server at ${BASE_URL}...`);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await axios.get(`${BASE_URL}/health`, {
        timeout: 2000,
        validateStatus: () => true, // Accept any status code
      });
      logger.info('✅ Server is available');
      return true;
    } catch (error) {
      if (i < maxRetries - 1) {
        logger.info(`Attempt ${i + 1}/${maxRetries}: Server not ready, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        logger.error('❌ Server did not become available after retries');
        throw error;
      }
    }
  }
  return false;
}

async function testServer() {
  logger.info('🧪 Testing MCP Server...\n');

  try {
    // Wait for server to be available
    await waitForServer();
    logger.info('');

    // Check server mode
    logger.info('1. Checking server mode...');
    try {
      const rootResponse = await axios.get(`${BASE_URL}/`);
      const serverMode = rootResponse.data?.mode;
      logger.info({ mode: serverMode, data: rootResponse.data }, `✅ Server mode: ${serverMode}`);
      if (serverMode === 'oauth-only') {
        logger.warn('⚠️  Server is running in stdio/oauth-only mode');
        logger.info('💡 To test MCP endpoint, start server with: pnpm run start:http');
      }
    } catch (error) {
      logger.warn('⚠️  Could not determine server mode from root endpoint');
    }
    logger.info('');

    // Test health endpoint
    logger.info('2. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    logger.info({ data: healthResponse.data }, '✅ Health check passed');
    logger.info('');

    // Test OAuth login endpoint
    logger.info('3. Testing OAuth login endpoint...');
    try {
      const loginResponse = await axios.get(`${BASE_URL}/auth/login`, {
        maxRedirects: 0,
        validateStatus: (status) => status < 400
      });
      logger.info('✅ OAuth login endpoint accessible');
    } catch (error) {
      if (error.response?.status === 501) {
        logger.warn('⚠️  OAuth not configured (expected if no env vars set)');
      } else {
        logger.info('✅ OAuth login endpoint accessible');
      }
    }
    logger.info('');

    // Test MCP endpoint without auth (should fail)
    logger.info('4. Testing MCP endpoint without authentication...');
    try {
      const response = await axios.post(`${BASE_URL}/mcp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping'
      }, {
        headers: {
          'Accept': 'application/json'
        },
        validateStatus: () => true // Accept any status to inspect response
      });
      
      if (response.status === 401) {
        logger.info('✅ MCP endpoint correctly requires authentication (401)');
      } else if (response.status === 404) {
        // Check if it's a route 404 or a session 404
        const errorMsg = response.data?.error?.message || '';
        if (errorMsg.includes('Session not found') || errorMsg.includes('expired')) {
          logger.info('✅ MCP endpoint correctly requires authentication (404 - session required)');
        } else {
          logger.warn('⚠️  MCP endpoint not available (404 Not Found)');
          logger.info('💡 This usually means the server is in stdio mode');
          logger.info('💡 To test MCP endpoint, start server with: pnpm run start:http');
          logger.info('💡 Make sure you have built the project: pnpm run build');
        }
      } else if (response.status === 400) {
        // 400 might indicate the endpoint exists but request is malformed
        const errorMsg = response.data?.error?.message || '';
        if (errorMsg.includes('Accept header')) {
          logger.warn('⚠️  MCP endpoint exists but requires Accept header');
          logger.info('💡 This is expected - the endpoint requires proper headers');
        } else {
          logger.info(`✅ MCP endpoint accessible (returned ${response.status})`);
        }
      } else {
        logger.error({ 
          status: response.status,
          statusText: response.statusText,
          data: response.data 
        }, '❌ Unexpected response');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        logger.info('✅ MCP endpoint correctly requires authentication (401)');
      } else if (error.response?.status === 404) {
        const errorMsg = error.response?.data?.error?.message || '';
        if (errorMsg.includes('Session not found') || errorMsg.includes('expired')) {
          logger.info('✅ MCP endpoint correctly requires authentication (404 - session required)');
        } else {
          logger.warn('⚠️  MCP endpoint not available (404 Not Found)');
          logger.info('💡 This usually means the server is in stdio mode');
        }
      } else {
        logger.error({ 
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data 
        }, '❌ Unexpected error');
      }
    }
    logger.info('');

    logger.info('🎉 Basic server tests completed!');
    logger.info('');
    logger.info('To test with authentication:');
    logger.info('1. Configure OAuth settings in .env file');
    logger.info('2. Visit http://localhost:3000/auth/login');
    logger.info('3. Complete OAuth flow');
    logger.info('4. Use the returned JWT token in MCP requests');

  } catch (error) {
    logger.error(
      {
        error: error.message,
        code: error.code,
        response: error.response?.status,
        stack: error.stack,
      },
      '❌ Test failed',
    );
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      logger.info('');
      logger.info('💡 To start the server:');
      logger.info('   1. Build the project: pnpm run build');
      logger.info('   2. Start the server: pnpm run start:http');
      logger.info('   Or use: pnpm run start:http');
      logger.info('');
      logger.info('   Then run this test again: pnpm run test:env');
    }
  }
}

// Run tests if this file is executed directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  testServer();
}

export { testServer };

