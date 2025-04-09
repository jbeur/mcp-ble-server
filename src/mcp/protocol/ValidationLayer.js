const CachingLayer = require('../server/CachingLayer');
const { MESSAGE_TYPES } = require('./messages');
const { logger } = require('../../utils/logger');
const metrics = require('../../utils/metrics');

/**
 * ValidationLayer class for efficient protocol message validation with caching
 */
class ValidationLayer {
  constructor(config = {}) {
    this.schemaCacheTTL = config.schemaCacheTTL || 3600000; // 1 hour
    this.validationCacheTTL = config.validationCacheTTL || 60000; // 1 minute
    this.maxSchemaCacheSize = config.maxSchemaCacheSize || 100;
    this.maxValidationCacheSize = config.maxValidationCacheSize || 1000;

    // Initialize schema store
    this.schemaStore = new Map();

    // Initialize caches
    this.schemaCache = new CachingLayer({
      ttl: this.schemaCacheTTL,
      maxSize: this.maxSchemaCacheSize,
      priority: 'high',
      name: 'schema-cache'
    });

    this.validationCache = new CachingLayer({
      ttl: this.validationCacheTTL,
      maxSize: this.maxValidationCacheSize,
      priority: 'low',
      name: 'validation-cache'
    });

    // Initialize schemas
    this.initializeSchemas();
  }

  /**
     * Initialize and cache message schemas
     */
  initializeSchemas() {
    try {
      // Authentication message schema
      const authSchema = {
        type: 'object',
        required: ['type', 'token'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.AUTHENTICATE] },
          token: { type: 'string' }
        }
      };
      this.schemaStore.set(MESSAGE_TYPES.AUTHENTICATE, authSchema);
      this.cacheSchema(MESSAGE_TYPES.AUTHENTICATE, authSchema);

      // Start scan message schema
      const scanSchema = {
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
      this.schemaStore.set(MESSAGE_TYPES.START_SCAN, scanSchema);
      this.cacheSchema(MESSAGE_TYPES.START_SCAN, scanSchema);

      // Characteristic read message schema
      const readSchema = {
        type: 'object',
        required: ['type', 'deviceId', 'serviceId', 'characteristicId'],
        properties: {
          type: { type: 'string', enum: [MESSAGE_TYPES.CHARACTERISTIC_READ] },
          deviceId: { type: 'string' },
          serviceId: { type: 'string' },
          characteristicId: { type: 'string' }
        }
      };
      this.schemaStore.set(MESSAGE_TYPES.CHARACTERISTIC_READ, readSchema);
      this.cacheSchema(MESSAGE_TYPES.CHARACTERISTIC_READ, readSchema);
    } catch (error) {
      logger.error('Failed to initialize schemas:', error);
      throw error;
    }
  }

  /**
     * Cache a schema for a message type
     * @param {string} messageType - The message type
     * @param {object} schema - The schema object
     */
  cacheSchema(messageType, schema) {
    try {
      this.schemaCache.set(messageType, schema, { priority: 'high' });
    } catch (error) {
      logger.error(`Failed to cache schema for ${messageType}:`, error);
      throw error;
    }
  }

  /**
     * Get a schema for a message type
     * @param {string} messageType - The message type
     * @returns {object|null} The schema object or null if not found
     */
  getSchema(messageType) {
    try {
      let schema = this.schemaCache.get(messageType);

      if (!schema) {
        // If schema is not in cache, get it from memory
        schema = this.getSchemaFromMemory(messageType);
        if (schema) {
          this.cacheSchema(messageType, schema);
        }
      }

      return schema;
    } catch (error) {
      logger.error(`Failed to get schema for ${messageType}:`, error);
      return null;
    }
  }

  /**
     * Get a schema from memory
     * @param {string} messageType - The message type
     * @returns {object|null} The schema object or null if not found
     */
  getSchemaFromMemory(messageType) {
    const schema = this.schemaStore.get(messageType);
    if (schema) {
      return JSON.parse(JSON.stringify(schema));
    }
    return null;
  }

  /**
     * Validate a message
     * @param {object} message - The message to validate
     * @returns {object} Validation result with isValid and errors
     */
  validateMessage(message) {
    if (!message || typeof message !== 'object') {
      return { isValid: false, errors: ['Invalid message format'] };
    }

    const cacheKey = JSON.stringify(message);
    let result = this.validationCache.get(cacheKey);

    if (result) {
      metrics.increment('validation.cache.hit');
      return result;
    }

    metrics.increment('validation.cache.miss');
    result = this.performValidation(message);
        
    if (result.isValid) {
      this.validationCache.set(cacheKey, result, { priority: 'low' });
    }

    return result;
  }

  /**
     * Perform actual message validation
     * @param {object} message - The message to validate
     * @returns {object} Validation result with isValid and errors
     */
  performValidation(message) {
    const { type } = message;
    if (!type || !Object.values(MESSAGE_TYPES).includes(type)) {
      return { isValid: false, errors: ['Unknown message type'] };
    }

    const schema = this.getSchema(type);
    if (!schema) {
      return { isValid: false, errors: ['Unknown message type'] };
    }

    const errors = this.validateAgainstSchema(message, schema);
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
     * Validate a message against its schema
     * @param {object} message - The message to validate
     * @param {object} schema - The schema to validate against
     * @returns {string[]} Array of validation errors
     */
  validateAgainstSchema(message, schema) {
    const errors = [];

    // Check required fields
    for (const field of schema.required || []) {
      if (!(field in message)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate properties
    for (const [key, value] of Object.entries(message)) {
      const propertySchema = schema.properties[key];
      if (propertySchema) {
        const propertyErrors = this.validateProperty(value, propertySchema);
        if (propertyErrors.length > 0) {
          errors.push(...propertyErrors.map(error => `${key}: ${error}`));
        }
      }
    }

    return errors;
  }

  /**
     * Validate a property against its schema
     * @param {any} value - The value to validate
     * @param {object} schema - The schema to validate against
     * @returns {string[]} Array of validation errors
     */
  validateProperty(value, schema) {
    const errors = [];

    switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push('Invalid type');
      } else if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`Value must be one of: ${schema.enum.join(', ')}`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push('Invalid type');
      } else if (schema.items) {
        value.forEach((item, index) => {
          const itemErrors = this.validateProperty(item, schema.items);
          if (itemErrors.length > 0) {
            errors.push(...itemErrors.map(error => `[${index}]: ${error}`));
          }
        });
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null) {
        errors.push('Invalid type');
      } else if (schema.properties) {
        const objectErrors = this.validateAgainstSchema(value, schema);
        if (objectErrors.length > 0) {
          errors.push(...objectErrors);
        }
      }
      break;

    default:
      errors.push(`Unsupported type: ${schema.type}`);
    }

    return errors;
  }

  /**
     * Clear both schema and validation caches
     */
  clearCaches() {
    try {
      this.schemaCache.clear();
      this.validationCache.clear();
    } catch (error) {
      logger.error('Failed to clear caches:', error);
      throw error;
    }
  }
}

module.exports = ValidationLayer; 