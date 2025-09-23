#!/usr/bin/env node

const axios = require('axios');
const pino = require('pino');

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

const BASE_URL = 'http://localhost:3000';

async function testServer() {
  logger.info('🧪 Testing MCP Server...\n');

  try {
    // Test health endpoint
    logger.info('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    logger.info({ data: healthResponse.data }, '✅ Health check passed');
    logger.info('');

    // Note: OAuth login endpoint has been removed - using session token authentication
    logger.info('2. OAuth login endpoint removed (using session token auth)');

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
    logger.info('1. Configure OAuth client credentials in .env file');
    logger.info('2. Use session token authentication (client credentials flow)');
    logger.info('3. Access tokens are automatically obtained via client credentials grant');

  } catch (error) {
    logger.error({ error: error.message }, '❌ Test failed');
    if (error.code === 'ECONNREFUSED') {
      logger.info('💡 Make sure the server is running: pnpm dev:http');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testServer();
}

module.exports = { testServer };
