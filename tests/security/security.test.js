const { WebSocketServer } = require('../../src/mcp/server/WebSocketServer');
const { logger } = require('../../src/utils/logger');
const { metrics } = require('../../src/utils/metrics');
const { MESSAGE_TYPES, ERROR_CODES } = require('../../src/mcp/protocol/messages');
const WebSocketTestHelper = require('../helpers/WebSocketTestHelper');

const TEST_PORT = 8083;
const SERVER_STARTUP_TIMEOUT = 5000;
const SERVER_SHUTDOWN_TIMEOUT = 5000;
const TEST_TIMEOUT = 30000;
const VALID_API_KEY = 'valid-api-key';

// Mock configuration
const mockConfig = {
  security: {
    tokenAuth: {
      accessTokenSecret: 'test-access-token-secret',
      refreshTokenSecret: 'test-refresh-token-secret',
      algorithm: 'HS256',
      accessTokenExpiry: '15m',
      refreshTokenExpiry: '7d'
    },
    apiKey: {
      rotationInterval: 3600000,
      maxAge: 86400000
    }
  }
};

let server;
let activeConnections = [];

const ensureServerStopped = async () => {
  if (server) {
    try {
      await server.stop();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
      server = null;
    } catch (error) {
      logger.error('Error stopping server:', error);
    }
  }
};

const cleanupConnections = async () => {
  if (activeConnections.length === 0) return;
    
  const closePromises = activeConnections.map(async (ws) => {
    try {
      await ws.close();
    } catch (error) {
      logger.error('Error closing connection:', error);
    }
  });
    
  await Promise.all(closePromises);
  activeConnections = [];
  await new Promise(resolve => setTimeout(resolve, 500)); // Wait for cleanup
};

describe('Security Tests', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create server with mock config
    server = new WebSocketServer(mockConfig);
  });

  afterEach(() => {
    // Cleanup
    server.close();
  });

  describe('Authentication Security', () => {
    it('should reject invalid API keys', async () => {
      const invalidKey = 'invalid-api-key';
      await expect(server.validateApiKey(invalidKey)).rejects.toThrow('Invalid API key');
    });

    it('should validate session tokens', async () => {
      const token = await server.generateToken('test-client');
      const isValid = await server.validateToken(token);
      expect(isValid).toBe(true);
    });
  });

  describe('Input Validation Security', () => {
    it('should reject malformed messages', async () => {
      const malformedMessage = {
        type: 'INVALID',
        data: null
      };
      await expect(server.processMessage(malformedMessage)).rejects.toThrow('Invalid message format');
    });
  });
}); 