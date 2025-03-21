const WebSocket = require('ws');
const WebSocketServer = require('../../../../src/mcp/server/WebSocketServer');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');

describe('WebSocketServer', () => {
  let server;
  let mockWss;
  let mockClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock WebSocket server
    mockWss = {
      on: jest.fn(),
      close: jest.fn((callback) => callback && callback()),
    };

    // Create mock WebSocket client
    mockClient = {
      on: jest.fn(),
      readyState: WebSocket.OPEN,
      send: jest.fn(),
    };

    // Mock WebSocket.Server constructor
    WebSocket.Server = jest.fn().mockImplementation(() => mockWss);

    // Create server instance
    server = new WebSocketServer(8080);
  });

  describe('start', () => {
    it('should start the WebSocket server successfully', () => {
      server.start();
      
      expect(WebSocket.Server).toHaveBeenCalledWith({ port: 8080 });
      expect(mockWss.on).toHaveBeenCalledWith('connection', expect.any(Function));
      expect(mockWss.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(logger.info).toHaveBeenCalledWith('MCP WebSocket server started on port 8080');
      expect(metrics.mcpServerStatus.set).toHaveBeenCalledWith(1);
    });

    it('should handle server start errors', () => {
      const error = new Error('Failed to start server');
      WebSocket.Server.mockImplementationOnce(() => {
        throw error;
      });

      expect(() => server.start()).toThrow(error);
      expect(logger.error).toHaveBeenCalledWith('Failed to start MCP WebSocket server', { error });
      expect(metrics.mcpServerStatus.set).toHaveBeenCalledWith(0);
    });
  });

  describe('stop', () => {
    it('should stop the WebSocket server successfully', async () => {
      server.wss = mockWss;
      await server.stop();

      expect(mockWss.close).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('MCP WebSocket server stopped');
      expect(metrics.mcpServerStatus.set).toHaveBeenCalledWith(0);
    });

    it('should handle server stop errors', async () => {
      const error = new Error('Failed to stop server');
      mockWss.close.mockImplementationOnce((callback) => callback(error));

      server.wss = mockWss;
      await expect(server.stop()).rejects.toThrow(error);
      expect(logger.error).toHaveBeenCalledWith('Error stopping MCP WebSocket server', { error });
    });
  });

  describe('handleConnection', () => {
    it('should handle new client connections', () => {
      const mockReq = {
        socket: {
          remoteAddress: '127.0.0.1'
        }
      };

      server.handleConnection(mockClient, mockReq);

      expect(server.clients.size).toBe(1);
      expect(server.connectionCount).toBe(1);
      expect(metrics.mcpConnections.set).toHaveBeenCalledWith(1);
      expect(logger.info).toHaveBeenCalledWith('New MCP client connected', expect.any(Object));
      expect(mockClient.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(String));
    });
  });

  describe('handleMessage', () => {
    beforeEach(() => {
      jest.spyOn(server, 'sendError');
    });

    it('should handle valid JSON messages', () => {
      const clientId = 'test_client';
      const message = JSON.stringify({ type: 'test' });

      server.handleMessage(clientId, message);

      expect(metrics.mcpMessagesReceived.inc).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith('Received MCP message', expect.any(Object));
    });

    it('should handle invalid JSON messages', () => {
      const clientId = 'test_client';
      const message = 'invalid json';

      server.handleMessage(clientId, message);

      expect(logger.error).toHaveBeenCalledWith('Error handling MCP message', expect.any(Object));
      expect(server.sendError).toHaveBeenCalledWith(clientId, 'INVALID_MESSAGE', 'Failed to parse message');
      expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: 'message_parse_error' });
    });
  });

  describe('handleDisconnect', () => {
    it('should handle client disconnections', () => {
      const clientId = 'test_client';
      server.clients.set(clientId, mockClient);
      server.connectionCount = 1;

      server.handleDisconnect(clientId);

      expect(server.clients.has(clientId)).toBe(false);
      expect(server.connectionCount).toBe(0);
      expect(metrics.mcpConnections.set).toHaveBeenCalledWith(0);
      expect(logger.info).toHaveBeenCalledWith('MCP client disconnected', { clientId });
    });
  });

  describe('sendToClient', () => {
    it('should send messages to connected clients', () => {
      const clientId = 'test_client';
      const message = { type: 'test' };
      server.clients.set(clientId, mockClient);

      server.sendToClient(clientId, message);

      expect(mockClient.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(metrics.mcpMessagesSent.inc).toHaveBeenCalled();
    });

    it('should handle sending to disconnected clients', () => {
      const clientId = 'test_client';
      const message = { type: 'test' };
      server.clients.set(clientId, { ...mockClient, readyState: WebSocket.CLOSED });

      server.sendToClient(clientId, message);

      expect(logger.warn).toHaveBeenCalledWith('Attempted to send message to disconnected client', { clientId });
    });
  });
}); 