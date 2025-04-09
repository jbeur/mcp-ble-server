const ValidationLayer = require('../../../../src/mcp/protocol/ValidationLayer');
const { MESSAGE_TYPES } = require('../../../../src/mcp/protocol/messages');
const CachingLayer = require('../../../../src/mcp/server/CachingLayer');
const logger = require('../../../../src/utils/logger');
const metrics = require('../../../../src/utils/metrics');

// Mock dependencies
jest.mock('../../../../src/mcp/server/CachingLayer');
jest.mock('../../../../src/utils/logger');
jest.mock('../../../../src/utils/metrics', () => ({
  increment: jest.fn()
}));

describe('ValidationLayer', () => {
  let validationLayer;
  let mockSchemaCache;
  let mockValidationCache;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock cache instances
    mockSchemaCache = {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn()
    };

    mockValidationCache = {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn()
    };

    // Mock CachingLayer constructor
    CachingLayer.mockImplementation((config) => {
      if (config.priority === 'high') {
        return mockSchemaCache;
      }
      return mockValidationCache;
    });

    // Create validation layer instance
    validationLayer = new ValidationLayer();
  });

  describe('Schema Caching', () => {
    it('should cache schemas on initialization', () => {
      // Verify that schemas were cached
      expect(mockSchemaCache.set).toHaveBeenCalledTimes(3); // AUTHENTICATE, START_SCAN, CHARACTERISTIC_READ
      expect(mockSchemaCache.set).toHaveBeenCalledWith(
        MESSAGE_TYPES.AUTHENTICATE,
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should get schema from cache first', () => {
      const mockSchema = { type: 'object', properties: {} };
      mockSchemaCache.get.mockReturnValue(mockSchema);

      const schema = validationLayer.getSchema(MESSAGE_TYPES.AUTHENTICATE);
      expect(schema).toBe(mockSchema);
      expect(mockSchemaCache.get).toHaveBeenCalledWith(MESSAGE_TYPES.AUTHENTICATE);
    });

    it('should fallback to memory if not in cache', () => {
      // First call returns null (cache miss)
      mockSchemaCache.get.mockReturnValueOnce(null);
            
      // Second call returns the schema (from memory)
      const mockSchema = {
        type: 'object',
        properties: {}
      };
      mockSchemaCache.get.mockReturnValueOnce(mockSchema);

      const schema = validationLayer.getSchema(MESSAGE_TYPES.AUTHENTICATE);
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });
  });

  describe('Validation Result Caching', () => {
    it('should cache validation results', () => {
      const message = {
        type: MESSAGE_TYPES.AUTHENTICATE,
        token: 'test-token'
      };

      // Mock schema retrieval
      const mockSchema = {
        type: 'object',
        required: ['type', 'token'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.AUTHENTICATE] },
          token: { type: 'string' }
        }
      };
      mockSchemaCache.get.mockReturnValue(mockSchema);

      mockValidationCache.get.mockReturnValue(null);
      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(true);
      expect(mockValidationCache.set).toHaveBeenCalledWith(
        JSON.stringify(message),
        expect.any(Object),
        expect.any(Object)
      );
      expect(metrics.increment).toHaveBeenCalledWith('validation.cache.miss');
    });

    it('should handle cache misses', () => {
      const message = {
        type: MESSAGE_TYPES.AUTHENTICATE,
        token: 'test-token'
      };

      // Mock schema retrieval
      const mockSchema = {
        type: 'object',
        required: ['type', 'token'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.AUTHENTICATE] },
          token: { type: 'string' }
        }
      };
      mockSchemaCache.get.mockReturnValue(mockSchema);

      mockValidationCache.get.mockReturnValue(null);
      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(true);
      expect(mockValidationCache.get).toHaveBeenCalledWith(
        JSON.stringify(message)
      );
      expect(metrics.increment).toHaveBeenCalledWith('validation.cache.miss');
    });
  });

  describe('Fast-path Validation', () => {
    beforeEach(() => {
      // Mock schema retrieval for all tests
      const mockSchema = {
        type: 'object',
        required: ['type', 'token'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.AUTHENTICATE] },
          token: { type: 'string' }
        }
      };
      mockSchemaCache.get.mockReturnValue(mockSchema);
    });

    it('should validate authentication message', () => {
      const message = {
        type: MESSAGE_TYPES.AUTHENTICATE,
        token: 'test-token'
      };

      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate start scan message', () => {
      const message = {
        type: MESSAGE_TYPES.START_SCAN,
        filters: [{ name: 'test-device' }]
      };

      // Mock schema for START_SCAN
      const mockSchema = {
        type: 'object',
        required: ['type', 'filters'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.START_SCAN] },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' }
              }
            }
          }
        }
      };
      mockSchemaCache.get.mockReturnValue(mockSchema);

      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate characteristic read message', () => {
      const message = {
        type: MESSAGE_TYPES.CHARACTERISTIC_READ,
        deviceId: 'test-device',
        serviceId: 'test-service',
        characteristicId: 'test-characteristic'
      };

      // Mock schema for CHARACTERISTIC_READ
      const mockSchema = {
        type: 'object',
        required: ['type', 'deviceId', 'serviceId', 'characteristicId'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.CHARACTERISTIC_READ] },
          deviceId: { type: 'string' },
          serviceId: { type: 'string' },
          characteristicId: { type: 'string' }
        }
      };
      mockSchemaCache.get.mockReturnValue(mockSchema);

      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle unknown message types', () => {
      const message = {
        type: 'UNKNOWN_TYPE',
        data: {}
      };

      mockSchemaCache.get.mockReturnValue(null);

      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unknown message type');
    });

    it('should handle malformed messages', () => {
      const message = {
        type: MESSAGE_TYPES.AUTHENTICATE
        // Missing required token field
      };

      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: token');
    });
  });

  describe('Cache Management', () => {
    it('should clear both caches', () => {
      validationLayer.clearCaches();
      expect(mockSchemaCache.clear).toHaveBeenCalled();
      expect(mockValidationCache.clear).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', () => {
      const message = {
        type: MESSAGE_TYPES.AUTHENTICATE,
        token: 123 // Invalid type
      };

      // Mock schema retrieval
      const mockSchema = {
        type: 'object',
        required: ['type', 'token'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.AUTHENTICATE] },
          token: { type: 'string' }
        }
      };
      mockSchemaCache.get.mockReturnValue(mockSchema);

      const result = validationLayer.validateMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('token: Invalid type');
    });
  });
}); 