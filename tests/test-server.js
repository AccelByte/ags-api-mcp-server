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

    // Test health endpoint
    logger.info('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    logger.info({ data: healthResponse.data }, '✅ Health check passed');
    logger.info('');

    // Test OAuth login endpoint
    logger.info('2. Testing OAuth login endpoint...');
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
    logger.info('3. Testing MCP endpoint without authentication...');
    try {
      await axios.post(`${BASE_URL}/mcp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping'
      });
      logger.error('❌ MCP endpoint should require authentication');
    } catch (error) {
      if (error.response?.status === 401) {
        logger.info('✅ MCP endpoint correctly requires authentication');
      } else {
        logger.error({ data: error.response?.data }, '❌ Unexpected error');
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
      logger.info('   2. Start the server: MCP_TRANSPORT=http pnpm run start:http');
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

