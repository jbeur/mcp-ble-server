const { MESSAGE_TYPES } = require('../../../../src/mcp/protocol/messages');
const { HandlerFactory } = require('../../../../src/mcp/handlers/HandlerFactory');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics', () => ({
  metrics: {
    increment: jest.fn()
  }
}));

// Mock handler classes
const mockAuthHandler = {
  handleMessage: jest.fn(),
  handleClientDisconnect: jest.fn().mockResolvedValue(undefined)
};

const mockScanHandler = {
  handleMessage: jest.fn(),
  handleClientDisconnect: jest.fn().mockResolvedValue(undefined)
};

const mockConnectionHandler = {
  handleMessage: jest.fn(),
  handleClientDisconnect: jest.fn().mockResolvedValue(undefined)
};

jest.mock('../../../../src/mcp/handlers/AuthHandler', () => ({
  AuthHandler: jest.fn(() => mockAuthHandler)
}));

jest.mock('../../../../src/mcp/handlers/ScanHandler', () => ({
  ScanHandler: jest.fn(() => mockScanHandler)
}));

jest.mock('../../../../src/mcp/handlers/ConnectionHandler', () => ({
  ConnectionHandler: jest.fn(() => mockConnectionHandler)
}));

// Mock BLEService
jest.mock('../../../../src/ble/bleService', () => {
  return jest.fn().mockImplementation(() => ({
    startScan: jest.fn().mockResolvedValue(undefined),
    stopScan: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    removeListener: jest.fn(),
    discoveredDevices: new Map(),
    connectedDevices: new Map()
  }));
});

describe('HandlerFactory', () => {
  let handlerFactory;
  let mockAuthService;
  let mockBleService;
  let AuthHandler;
  let ScanHandler;
  let ConnectionHandler;

  beforeEach(() => {
    mockAuthService = {
      validateSession: jest.fn(),
      activeSessions: new Map()
    };

    mockBleService = {
      startScan: jest.fn(),
      stopScan: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn()
    };

    // Get the mocked classes
    AuthHandler = require('../../../../src/mcp/handlers/AuthHandler').AuthHandler;
    ScanHandler = require('../../../../src/mcp/handlers/ScanHandler').ScanHandler;
    ConnectionHandler = require('../../../../src/mcp/handlers/ConnectionHandler').ConnectionHandler;

    // Reset all mocks
    jest.clearAllMocks();

    handlerFactory = new HandlerFactory(mockAuthService, mockBleService);
  });

  describe('initializeHandlers', () => {
    it('should initialize all required handlers', () => {
      expect(AuthHandler).toHaveBeenCalledWith(mockAuthService);
      expect(ScanHandler).toHaveBeenCalledWith(mockBleService);
      expect(ConnectionHandler).toHaveBeenCalledWith(mockBleService);

      expect(handlerFactory.handlers.get(MESSAGE_TYPES.AUTHENTICATE)).toBe(mockAuthHandler);
      expect(handlerFactory.handlers.get(MESSAGE_TYPES.START_SCAN)).toBe(mockScanHandler);
      expect(handlerFactory.handlers.get(MESSAGE_TYPES.CONNECT)).toBe(mockConnectionHandler);

      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.init.success');
    });

    it('should handle initialization errors', () => {
      const error = new Error('Init error');
      AuthHandler.mockImplementationOnce(() => {
        throw error;
      });

      expect(() => {
        new HandlerFactory(mockAuthService, mockBleService);
      }).toThrow(error);

      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.init.error');
    });
  });

  describe('getHandler', () => {
    it('should return handler for valid message type', () => {
      const handler = handlerFactory.getHandler(MESSAGE_TYPES.AUTHENTICATE);
      expect(handler).toBe(mockAuthHandler);
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.get_handler.success');
    });

    it('should throw error for invalid message type', () => {
      expect(() => {
        handlerFactory.getHandler('INVALID_TYPE');
      }).toThrow('No handler found for message type: INVALID_TYPE');

      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.get_handler.not_found');
    });
  });

  describe('handleMessage', () => {
    const clientId = 'test-client';

    it('should handle valid message', async () => {
      const message = { type: MESSAGE_TYPES.AUTHENTICATE, data: {} };
      await handlerFactory.handleMessage(clientId, message);
      expect(mockAuthHandler.handleMessage).toHaveBeenCalledWith(clientId, message);
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.handle_message.success');
    });

    it('should handle invalid message format', async () => {
      await expect(handlerFactory.handleMessage(clientId, null))
        .rejects.toThrow('Invalid message format');
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.handle_message.invalid_format');

      await expect(handlerFactory.handleMessage(clientId, {}))
        .rejects.toThrow('Invalid message format: missing or invalid type');
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.handle_message.missing_type');
    });

    it('should handle handler errors', async () => {
      const message = { type: MESSAGE_TYPES.AUTHENTICATE, data: {} };
      const error = new Error('Handler error');
      mockAuthHandler.handleMessage.mockRejectedValue(error);

      await expect(handlerFactory.handleMessage(clientId, message))
        .rejects.toThrow(error);
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.handle_message.error');
    });
  });

  describe('handleClientDisconnect', () => {
    const clientId = 'test-client';

    it('should notify all handlers about client disconnect', async () => {
      await handlerFactory.handleClientDisconnect(clientId);

      expect(mockAuthHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
      expect(mockScanHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
      expect(mockConnectionHandler.handleClientDisconnect).toHaveBeenCalledWith(clientId);
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.client_disconnect.success');
    });

    it('should handle handler cleanup errors', async () => {
      const error = new Error('Cleanup error');
      mockAuthHandler.handleClientDisconnect.mockRejectedValueOnce(error);

      await expect(handlerFactory.handleClientDisconnect(clientId))
        .rejects.toThrow('Failed to disconnect client: 1 handlers reported errors');
      expect(metrics.increment).toHaveBeenCalledWith('handler_factory.client_disconnect.error');
    });
  });
}); 