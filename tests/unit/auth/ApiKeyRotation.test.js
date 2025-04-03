const crypto = require('crypto');
const ApiKeyRotation = require('../../../src/auth/ApiKeyRotation');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics');

describe('ApiKeyRotation', () => {
    let apiKeyRotation;
    let mockConfig;
    let mockMetrics;

    beforeEach(() => {
        mockConfig = {
            security: {
                apiKeyLength: 32,
                rotationInterval: 24 * 60 * 60, // 24 hours in seconds
                gracePeriod: 60 * 60, // 1 hour in seconds
                maxKeys: 2 // Maximum number of valid keys per client
            }
        };
        mockMetrics = {
            apiKeyRotationSuccess: { inc: jest.fn() },
            apiKeyRotationError: { inc: jest.fn() },
            apiKeyValidationSuccess: { inc: jest.fn() },
            apiKeyValidationError: { inc: jest.fn() }
        };
        apiKeyRotation = new ApiKeyRotation(mockConfig, mockMetrics);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('generateApiKey', () => {
        it('should generate a new API key with metadata', () => {
            const clientId = 'test-client';
            const result = apiKeyRotation.generateApiKey(clientId);

            expect(result).toHaveProperty('key');
            expect(result).toHaveProperty('createdAt');
            expect(result).toHaveProperty('expiresAt');
            expect(result.key).toHaveLength(64); // 32 bytes in hex = 64 characters
            expect(result.clientId).toBe(clientId);
            expect(mockMetrics.apiKeyRotationSuccess.inc).toHaveBeenCalled();
        });

        it('should handle invalid client ID', () => {
            expect(() => apiKeyRotation.generateApiKey('')).toThrow('Invalid client ID');
            expect(mockMetrics.apiKeyRotationError.inc).toHaveBeenCalled();
        });

        it('should generate unique keys', () => {
            const clientId = 'test-client';
            const key1 = apiKeyRotation.generateApiKey(clientId);
            const key2 = apiKeyRotation.generateApiKey(clientId);
            expect(key1.key).not.toBe(key2.key);
        });
    });

    describe('rotateApiKey', () => {
        it('should rotate API key and maintain history', () => {
            const clientId = 'test-client';
            const oldKey = apiKeyRotation.generateApiKey(clientId);
            const newKey = apiKeyRotation.rotateApiKey(clientId);

            expect(newKey.key).not.toBe(oldKey.key);
            expect(apiKeyRotation.isValidKey(clientId, oldKey.key)).toBe(true); // Old key still valid during grace period
            expect(apiKeyRotation.isValidKey(clientId, newKey.key)).toBe(true);
            expect(mockMetrics.apiKeyRotationSuccess.inc).toHaveBeenCalled();
        });

        it('should remove expired keys during rotation', () => {
            const clientId = 'test-client';
            const oldKey = apiKeyRotation.generateApiKey(clientId);
            
            // Simulate key expiration
            oldKey.expiresAt = Date.now() - 1000;
            apiKeyRotation.keyStore.set(clientId, [oldKey]);

            const newKey = apiKeyRotation.rotateApiKey(clientId);
            expect(apiKeyRotation.isValidKey(clientId, oldKey.key)).toBe(false);
            expect(apiKeyRotation.isValidKey(clientId, newKey.key)).toBe(true);
        });

        it('should maintain maximum number of valid keys', () => {
            const clientId = 'test-client';
            const key1 = apiKeyRotation.generateApiKey(clientId);
            const key2 = apiKeyRotation.rotateApiKey(clientId);
            const key3 = apiKeyRotation.rotateApiKey(clientId);

            // Only the two most recent keys should be valid
            expect(apiKeyRotation.isValidKey(clientId, key1.key)).toBe(false);
            expect(apiKeyRotation.isValidKey(clientId, key2.key)).toBe(true);
            expect(apiKeyRotation.isValidKey(clientId, key3.key)).toBe(true);
        });
    });

    describe('isValidKey', () => {
        it('should validate current API key', () => {
            const clientId = 'test-client';
            const { key } = apiKeyRotation.generateApiKey(clientId);
            
            expect(apiKeyRotation.isValidKey(clientId, key)).toBe(true);
            expect(mockMetrics.apiKeyValidationSuccess.inc).toHaveBeenCalled();
        });

        it('should reject expired API key', () => {
            const clientId = 'test-client';
            const apiKey = apiKeyRotation.generateApiKey(clientId);
            
            // Simulate key expiration
            apiKey.expiresAt = Date.now() - 1000;
            apiKeyRotation.keyStore.set(clientId, [apiKey]);

            expect(apiKeyRotation.isValidKey(clientId, apiKey.key)).toBe(false);
            expect(mockMetrics.apiKeyValidationError.inc).toHaveBeenCalled();
        });

        it('should reject invalid API key format', () => {
            const clientId = 'test-client';
            expect(apiKeyRotation.isValidKey(clientId, 'invalid-key')).toBe(false);
            expect(mockMetrics.apiKeyValidationError.inc).toHaveBeenCalled();
        });

        it('should reject API key from unknown client', () => {
            const clientId = 'test-client';
            const { key } = apiKeyRotation.generateApiKey(clientId);
            
            expect(apiKeyRotation.isValidKey('unknown-client', key)).toBe(false);
            expect(mockMetrics.apiKeyValidationError.inc).toHaveBeenCalled();
        });
    });

    describe('cleanup', () => {
        it('should remove expired keys', () => {
            const clientId = 'test-client';
            const apiKey = apiKeyRotation.generateApiKey(clientId);
            
            // Simulate key expiration
            apiKey.expiresAt = Date.now() - 1000;
            apiKeyRotation.keyStore.set(clientId, [apiKey]);

            apiKeyRotation.cleanup();
            expect(apiKeyRotation.isValidKey(clientId, apiKey.key)).toBe(false);
        });

        it('should maintain valid keys', () => {
            const clientId = 'test-client';
            const apiKey = apiKeyRotation.generateApiKey(clientId);
            
            apiKeyRotation.cleanup();
            expect(apiKeyRotation.isValidKey(clientId, apiKey.key)).toBe(true);
        });

        it('should handle empty key store', () => {
            expect(() => apiKeyRotation.cleanup()).not.toThrow();
        });
    });

    describe('error handling', () => {
        it('should handle key generation errors', () => {
            const originalRandomBytes = crypto.randomBytes;
            crypto.randomBytes = jest.fn(() => { throw new Error('Random bytes generation failed'); });

            expect(() => apiKeyRotation.generateApiKey('test-client')).toThrow();
            expect(mockMetrics.apiKeyRotationError.inc).toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalled();

            crypto.randomBytes = originalRandomBytes;
        });

        it('should handle key store errors', () => {
            const clientId = 'test-client';
            apiKeyRotation.keyStore = null;

            expect(() => apiKeyRotation.generateApiKey(clientId)).toThrow();
            expect(mockMetrics.apiKeyRotationError.inc).toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalled();
        });
    });
}); 