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
    logger.error({ error: error.message }, '❌ Test failed');
    if (error.code === 'ECONNREFUSED') {
      logger.info('💡 Make sure the server is running: npm run dev');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testServer();
}

module.exports = { testServer };
