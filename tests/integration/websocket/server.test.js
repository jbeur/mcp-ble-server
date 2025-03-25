const WebSocketServer = require('../../../src/websocket/server');
const { MockWebSocket, MockWebSocketServer } = require('../../helpers/mockWebSocket');
const { logger } = require('../../../src/utils/logger');

jest.mock('../../../src/utils/logger');
jest.mock('ws', () => ({
  Server: jest.fn().mockImplementation((options) => new MockWebSocketServer(options))
}));

describe('WebSocket Server Integration', () => {
  let wsServer;
  let mockWsServer;
  let mockClient;

  const TEST_PORT = 8080;
  const TEST_PATH = '/ws';
  const TEST_PROTOCOL = 'mcp-protocol';

  beforeEach(() => {
    // Initialize WebSocket server
    wsServer = new WebSocketServer({
      port: TEST_PORT,
      path: TEST_PATH,
      protocol: TEST_PROTOCOL
    });

    // Get mock server instance
    mockWsServer = wsServer.server;
    mockClient = new MockWebSocket(`ws://localhost:${TEST_PORT}${TEST_PATH}`, [TEST_PROTOCOL]);
  });

  afterEach(async () => {
    // Clean up WebSocket server
    try {
      await wsServer.cleanup();
    } catch (error) {
      // Ignore cleanup errors in afterEach
    }
    
    // Clean up mocks
    if (mockClient) {
      mockClient.cleanup();
    }
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Server Initialization', () => {
    it('should initialize WebSocket server with correct options', () => {
      expect(mockWsServer.options.port).toBe(TEST_PORT);
      expect(mockWsServer.options.path).toBe(TEST_PATH);
      expect(mockWsServer.options.protocol).toBe(TEST_PROTOCOL);
    });

    it('should handle server errors', async () => {
      const error = new Error('Server error');
      mockWsServer.simulateError(error);
      
      // Wait for error event to be processed
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(logger.error).toHaveBeenCalledWith('WebSocket server error:', error);
    });
  });

  describe('Client Connection Management', () => {
    it('should handle client connections', async () => {
      // Simulate client connection
      mockWsServer.handleUpgrade({ url: TEST_PATH, headers: {} }, {}, {});
      
      // Wait for connection event
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(mockWsServer.clientCount).toBe(1);
      expect(logger.info).toHaveBeenCalledWith('New WebSocket client connected');
    });

    it('should handle client disconnections', async () => {
      // Connect client
      mockWsServer.handleUpgrade({ url: TEST_PATH, headers: {} }, {}, {});
      await new Promise(resolve => process.nextTick(resolve));
      
      // Disconnect client
      const client = Array.from(mockWsServer.clients)[0];
      client.disconnect();
      
      // Wait for disconnect event
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(mockWsServer.clientCount).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('WebSocket client disconnected');
    });

    it('should handle client errors', async () => {
      // Connect client
      mockWsServer.handleUpgrade({ url: TEST_PATH, headers: {} }, {}, {});
      await new Promise(resolve => process.nextTick(resolve));
      
      // Simulate client error
      const client = Array.from(mockWsServer.clients)[0];
      const error = new Error('Client error');
      client.simulateError(error);
      
      // Wait for error event
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(logger.error).toHaveBeenCalledWith('WebSocket client error:', error);
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      // Connect client
      mockWsServer.handleUpgrade({ url: TEST_PATH, headers: {} }, {}, {});
      await new Promise(resolve => process.nextTick(resolve));
    });

    it('should handle incoming messages', async () => {
      const client = Array.from(mockWsServer.clients)[0];
      const message = { type: 'test', data: 'test data' };
      
      // Simulate message
      client.simulateMessage(JSON.stringify(message));
      
      // Wait for message processing
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(logger.debug).toHaveBeenCalledWith('Received WebSocket message:', message);
    });

    it('should handle invalid JSON messages', async () => {
      const client = Array.from(mockWsServer.clients)[0];
      const invalidMessage = 'invalid json';
      
      // Simulate invalid message
      client.simulateMessage(invalidMessage);
      
      // Wait for message processing
      await new Promise(resolve => process.nextTick(resolve));
      
      expect(logger.error).toHaveBeenCalledWith('Failed to parse WebSocket message:', expect.any(Error));
    });

    it('should handle message processing errors', async () => {
      const client = Array.from(mockWsServer.clients)[0];
      const message = { type: 'error', data: 'error data' };
      
      // Simulate message that causes error
      client.simulateMessage(JSON.stringify(message));
      
      // Wait for message processing
      await new Promise(resolve => process.nextTick(resolve));
      
      // Verify error handling
      const error = new Error('Test error message');
      expect(logger.error).toHaveBeenCalledWith('Failed to parse WebSocket message:', error);
      expect(logger.error).toHaveBeenCalledWith('WebSocket client error:', error);
    });
  });

  describe('Server Cleanup', () => {
    it('should properly cleanup server resources', async () => {
      // Connect some clients
      mockWsServer.handleUpgrade({ url: TEST_PATH, headers: {} }, {}, {});
      mockWsServer.handleUpgrade({ url: TEST_PATH, headers: {} }, {}, {});
      await new Promise(resolve => process.nextTick(resolve));
      
      // Cleanup server
      await wsServer.cleanup();
      
      expect(mockWsServer.clientCount).toBe(0);
      expect(mockWsServer.isListening).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('WebSocket server closed');
    });

    it('should handle cleanup errors', async () => {
      // Mock cleanup error
      const cleanupError = new Error('Cleanup error');
      jest.spyOn(mockWsServer, 'close').mockImplementation((callback) => {
        process.nextTick(() => {
          callback(cleanupError);
        });
      });
      
      // Verify error handling
      await expect(wsServer.cleanup()).rejects.toThrow(cleanupError);
      expect(logger.error).toHaveBeenCalledWith('Error closing WebSocket server:', cleanupError);
    });
  });
}); 