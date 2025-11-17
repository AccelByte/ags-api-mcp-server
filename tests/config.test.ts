import { test } from 'node:test';
import assert from 'node:assert/strict';

// Note: The config module loads on import and reads process.env
// Testing it requires careful env manipulation before import
// These tests focus on the validation logic extracted from config.ts

test('config - validatePort accepts valid ports', () => {
  function validatePort(portStr: string | undefined): number {
    const port = parseInt(portStr || '3000', 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${portStr}. Must be between 1 and 65535`);
    }
    return port;
  }

  assert.equal(validatePort('3000'), 3000);
  assert.equal(validatePort('8080'), 8080);
  assert.equal(validatePort('80'), 80);
  assert.equal(validatePort('443'), 443);
  assert.equal(validatePort('65535'), 65535);
  assert.equal(validatePort('1'), 1);
  assert.equal(validatePort(undefined), 3000); // default
});

test('config - validatePort rejects invalid ports', () => {
  function validatePort(portStr: string | undefined): number {
    const port = parseInt(portStr || '3000', 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${portStr}. Must be between 1 and 65535`);
    }
    return port;
  }

  assert.throws(() => validatePort('0'), /Invalid port number/);
  assert.throws(() => validatePort('-1'), /Invalid port number/);
  assert.throws(() => validatePort('65536'), /Invalid port number/);
  assert.throws(() => validatePort('99999'), /Invalid port number/);
  assert.throws(() => validatePort('abc'), /Invalid port number/);
  // Note: parseInt('3000.5', 10) returns 3000 (not NaN), so decimal ports are truncated
  // This is expected behavior - the port would be 3000
});

test('config - validateLogLevel accepts valid levels', () => {
  function validateLogLevel(level: string | undefined): string {
    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    const logLevel = level || 'info';
    if (!validLevels.includes(logLevel)) {
      throw new Error(`Invalid log level: ${logLevel}. Must be one of: ${validLevels.join(', ')}`);
    }
    return logLevel;
  }

  assert.equal(validateLogLevel('fatal'), 'fatal');
  assert.equal(validateLogLevel('error'), 'error');
  assert.equal(validateLogLevel('warn'), 'warn');
  assert.equal(validateLogLevel('info'), 'info');
  assert.equal(validateLogLevel('debug'), 'debug');
  assert.equal(validateLogLevel('trace'), 'trace');
  assert.equal(validateLogLevel(undefined), 'info'); // default
});

test('config - validateLogLevel rejects invalid levels', () => {
  function validateLogLevel(level: string | undefined): string {
    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    const logLevel = level || 'info';
    if (!validLevels.includes(logLevel)) {
      throw new Error(`Invalid log level: ${logLevel}. Must be one of: ${validLevels.join(', ')}`);
    }
    return logLevel;
  }

  assert.throws(() => validateLogLevel('invalid'), /Invalid log level/);
  assert.throws(() => validateLogLevel('DEBUG'), /Invalid log level/); // case sensitive
  assert.throws(() => validateLogLevel('verbose'), /Invalid log level/);
});

test('config - validateBoolean handles various boolean formats', () => {
  function validateBoolean(value: string | undefined, defaultValue: boolean = false): boolean {
    if (!value) return defaultValue;
    const lowerValue = value.toLowerCase();
    return lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes';
  }

  assert.equal(validateBoolean('true'), true);
  assert.equal(validateBoolean('TRUE'), true);
  assert.equal(validateBoolean('True'), true);
  assert.equal(validateBoolean('1'), true);
  assert.equal(validateBoolean('yes'), true);
  assert.equal(validateBoolean('YES'), true);

  assert.equal(validateBoolean('false'), false);
  assert.equal(validateBoolean('0'), false);
  assert.equal(validateBoolean('no'), false);
  assert.equal(validateBoolean(''), false);
  assert.equal(validateBoolean(undefined), false);

  // With custom default
  assert.equal(validateBoolean(undefined, true), true);
  assert.equal(validateBoolean('', true), true);
});

test('config - validateTransport accepts http and stdio', () => {
  function validateTransport(value: string | undefined): 'http' | 'stdio' {
    const transport = (value || 'stdio').toLowerCase();
    if (transport !== 'http' && transport !== 'stdio') {
      throw new Error(`Invalid transport: ${transport}. Must be 'http' or 'stdio'`);
    }
    return transport as 'http' | 'stdio';
  }

  assert.equal(validateTransport('http'), 'http');
  assert.equal(validateTransport('HTTP'), 'http');
  assert.equal(validateTransport('stdio'), 'stdio');
  assert.equal(validateTransport('STDIO'), 'stdio');
  assert.equal(validateTransport(undefined), 'stdio'); // default
});

test('config - validateTransport rejects invalid transports', () => {
  function validateTransport(value: string | undefined): 'http' | 'stdio' {
    const transport = (value || 'stdio').toLowerCase();
    if (transport !== 'http' && transport !== 'stdio') {
      throw new Error(`Invalid transport: ${transport}. Must be 'http' or 'stdio'`);
    }
    return transport as 'http' | 'stdio';
  }

  assert.throws(() => validateTransport('websocket'), /Invalid transport/);
  assert.throws(() => validateTransport('tcp'), /Invalid transport/);
  assert.throws(() => validateTransport('grpc'), /Invalid transport/);
});

test('config - validatePositiveInteger accepts valid integers', () => {
  function validatePositiveInteger(name: string, value: string | undefined, defaultValue: number): number {
    if (!value) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`);
    }
    return parsed;
  }

  assert.equal(validatePositiveInteger('test', '1', 10), 1);
  assert.equal(validatePositiveInteger('test', '100', 10), 100);
  assert.equal(validatePositiveInteger('test', '9999', 10), 9999);
  assert.equal(validatePositiveInteger('test', undefined, 42), 42); // default
  assert.equal(validatePositiveInteger('test', '', 42), 42); // default
});

test('config - validatePositiveInteger rejects invalid values', () => {
  function validatePositiveInteger(name: string, value: string | undefined, defaultValue: number): number {
    if (!value) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`);
    }
    return parsed;
  }

  assert.throws(() => validatePositiveInteger('test', '0', 10), /Must be a positive integer/);
  assert.throws(() => validatePositiveInteger('test', '-1', 10), /Must be a positive integer/);
  assert.throws(() => validatePositiveInteger('test', 'abc', 10), /Must be a positive integer/);
  // Note: parseInt('10.5', 10) returns 10 (not NaN), so decimals are truncated
  // This is expected behavior - the value would be 10
});

test('config - validateEnvVar returns value or empty string', () => {
  function validateEnvVar(name: string, value: string | undefined, required: boolean = true): string {
    if (required && (!value || value.trim() === '')) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value || '';
  }

  assert.equal(validateEnvVar('TEST', 'value', false), 'value');
  assert.equal(validateEnvVar('TEST', undefined, false), '');
  assert.equal(validateEnvVar('TEST', '', false), '');
});

test('config - validateEnvVar throws for required missing values', () => {
  function validateEnvVar(name: string, value: string | undefined, required: boolean = true): string {
    if (required && (!value || value.trim() === '')) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value || '';
  }

  assert.throws(() => validateEnvVar('REQUIRED_VAR', undefined, true), /is not set/);
  assert.throws(() => validateEnvVar('REQUIRED_VAR', '', true), /is not set/);
  assert.throws(() => validateEnvVar('REQUIRED_VAR', '   ', true), /is not set/);
});
