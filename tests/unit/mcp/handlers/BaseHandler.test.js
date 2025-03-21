const BaseHandler = require('../../../../src/mcp/handlers/BaseHandler');
const { logger } = require('../../../../src/utils/logger');
const { metrics } = require('../../../../src/utils/metrics');
const { MessageBuilder, ErrorCodes } = require('../../../../src/mcp/protocol/messages');

// Mock dependencies
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics');
jest.mock('../../../../src/mcp/protocol/messages', () => ({
  MessageBuilder: {
    buildError: jest.fn()
  },
  ErrorCodes: {
    INTERNAL_ERROR: 'INTERNAL_ERROR'
  }
}));

describe('BaseHandler', () => {
  let handler;
  let mockServer;
  let mockBleService;

  beforeEach(() => {
    // Create mock server
    mockServer = {
      sendToClient: jest.fn()
    };

    // Create mock BLE service
    mockBleService = {};

    // Create handler instance
    handler = new BaseHandler(mockServer, mockBleService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('handleMessage', () => {
    it('should handle valid messages', async () => {
      const clientId = 'test_client';
      const message = { type: 'test_type' };

      // Mock processMessage implementation
      handler.processMessage = jest.fn();

      await handler.handleMessage(clientId, message);

      expect(handler.processMessage).toHaveBeenCalledWith(clientId, message);
      expect(metrics.mcpMessageLatency.observe).toHaveBeenCalled();
    });

    it('should handle invalid message format', async () => {
      const clientId = 'test_client';
      const message = 'invalid';

      await handler.handleMessage(clientId, message);

      expect(logger.error).toHaveBeenCalledWith('Error handling message', expect.any(Object));
      expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: ErrorCodes.INTERNAL_ERROR });
      expect(mockServer.sendToClient).toHaveBeenCalled();
    });

    it('should handle missing message type', async () => {
      const clientId = 'test_client';
      const message = {};

      await handler.handleMessage(clientId, message);

      expect(logger.error).toHaveBeenCalledWith('Error handling message', expect.any(Object));
      expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: ErrorCodes.INTERNAL_ERROR });
      expect(mockServer.sendToClient).toHaveBeenCalled();
    });

    it('should handle processing errors', async () => {
      const clientId = 'test_client';
      const message = { type: 'test_type' };
      const error = new Error('Processing error');

      // Mock processMessage to throw an error
      handler.processMessage = jest.fn().mockRejectedValue(error);

      await handler.handleMessage(clientId, message);

      expect(logger.error).toHaveBeenCalledWith('Error handling message', expect.any(Object));
      expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: ErrorCodes.INTERNAL_ERROR });
      expect(mockServer.sendToClient).toHaveBeenCalled();
    });
  });

  describe('validateMessage', () => {
    it('should validate valid messages', async () => {
      const message = { type: 'test_type' };
      await expect(handler.validateMessage(message)).resolves.not.toThrow();
    });

    it('should throw error for invalid message format', async () => {
      const message = 'invalid';
      await expect(handler.validateMessage(message)).rejects.toThrow('Invalid message format');
    });

    it('should throw error for missing message type', async () => {
      const message = {};
      await expect(handler.validateMessage(message)).rejects.toThrow('Message type is required');
    });
  });

  describe('processMessage', () => {
    it('should throw error when not implemented', async () => {
      const clientId = 'test_client';
      const message = { type: 'test_type' };

      await expect(handler.processMessage(clientId, message)).rejects.toThrow('processMessage must be implemented by subclasses');
    });
  });

  describe('handleError', () => {
    it('should handle errors with custom error code', () => {
      const clientId = 'test_client';
      const error = new Error('Custom error');
      error.code = 'CUSTOM_ERROR';

      handler.handleError(clientId, error);

      expect(logger.error).toHaveBeenCalledWith('Error handling message', { clientId, error });
      expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: 'CUSTOM_ERROR' });
      expect(MessageBuilder.buildError).toHaveBeenCalledWith('CUSTOM_ERROR', 'Custom error');
    });

    it('should handle errors without custom error code', () => {
      const clientId = 'test_client';
      const error = new Error('Generic error');

      handler.handleError(clientId, error);

      expect(logger.error).toHaveBeenCalledWith('Error handling message', { clientId, error });
      expect(metrics.mcpErrors.inc).toHaveBeenCalledWith({ type: ErrorCodes.INTERNAL_ERROR });
      expect(MessageBuilder.buildError).toHaveBeenCalledWith(ErrorCodes.INTERNAL_ERROR, 'Generic error');
    });
  });

  describe('sendToClient', () => {
    it('should send message to client', () => {
      const clientId = 'test_client';
      const message = { type: 'test_type' };

      handler.sendToClient(clientId, message);

      expect(mockServer.sendToClient).toHaveBeenCalledWith(clientId, message);
    });
  });

  describe('createError', () => {
    it('should create error with custom code', () => {
      const code = 'CUSTOM_ERROR';
      const message = 'Custom error message';

      const error = handler.createError(code, message);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
    });
  });
}); 