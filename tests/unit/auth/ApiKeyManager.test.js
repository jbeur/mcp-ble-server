const ApiKeyManager = require('../../../src/auth/ApiKeyManager');
const metrics = require('../../../src/utils/metrics');
const logger = require('../../../src/utils/logger');

jest.mock('../../../src/utils/metrics', () => ({
    increment: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    error: jest.fn()
}));

describe('ApiKeyManager', () => {
    let apiKeyManager;
    const mockConfig = {
        auth: {
            keyRotationInterval: 1000, // 1 second for testing
            maxKeyAge: 5000 // 5 seconds for testing
        }
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        apiKeyManager = new ApiKeyManager(mockConfig);
    });

    afterEach(() => {
        jest.useRealTimers();
        apiKeyManager.stopRotationInterval();
    });

    describe('generateKey', () => {
        it('should generate a valid API key', () => {
            const key = apiKeyManager.generateKey();
            expect(key).toMatch(/^[0-9a-f]{64}$/); // 32 bytes in hex
        });
    });

    describe('createKey', () => {
        it('should create a new API key for a client', () => {
            const clientId = 'test-client';
            const key = apiKeyManager.createKey(clientId);

            expect(key).toMatch(/^[0-9a-f]{64}$/);
            expect(apiKeyManager.apiKeys.has(clientId)).toBe(true);
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.creation.success');
        });

        it('should throw error for invalid client ID', () => {
            expect(() => apiKeyManager.createKey(null)).toThrow('Client ID is required');
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.creation.error');
        });
    });

    describe('rotateKey', () => {
        it('should rotate an existing API key', () => {
            const clientId = 'test-client';
            const originalKey = apiKeyManager.createKey(clientId);
            const newKey = apiKeyManager.rotateKey(clientId);

            expect(newKey).not.toBe(originalKey);
            expect(apiKeyManager.apiKeys.get(clientId).key).toBe(newKey);
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.rotation.success');
        });

        it('should throw error for non-existent client', () => {
            expect(() => apiKeyManager.rotateKey('non-existent')).toThrow('Client does not have an API key');
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.rotation.error');
        });
    });

    describe('validateKey', () => {
        it('should validate a correct API key', () => {
            const clientId = 'test-client';
            const key = apiKeyManager.createKey(clientId);
            const isValid = apiKeyManager.validateKey(clientId, key);

            expect(isValid).toBe(true);
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.validation.success');
        });

        it('should reject an incorrect API key', () => {
            const clientId = 'test-client';
            apiKeyManager.createKey(clientId);
            const isValid = apiKeyManager.validateKey(clientId, 'invalid-key');

            expect(isValid).toBe(false);
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.validation.error');
        });

        it('should handle non-existent client', () => {
            const isValid = apiKeyManager.validateKey('non-existent', 'any-key');
            expect(isValid).toBe(false);
        });
    });

    describe('needsRotation', () => {
        it('should detect when key needs rotation', () => {
            const clientId = 'test-client';
            apiKeyManager.createKey(clientId);

            // Advance time past rotation interval
            jest.advanceTimersByTime(mockConfig.auth.keyRotationInterval + 1000);

            expect(apiKeyManager.needsRotation(clientId)).toBe(true);
        });

        it('should detect when key needs rotation due to max age', () => {
            const clientId = 'test-client';
            apiKeyManager.createKey(clientId);

            // Advance time past max age
            jest.advanceTimersByTime(mockConfig.auth.maxKeyAge + 1000);

            expect(apiKeyManager.needsRotation(clientId)).toBe(true);
        });

        it('should return false for non-existent client', () => {
            expect(apiKeyManager.needsRotation('non-existent')).toBe(false);
        });
    });

    describe('rotation interval', () => {
        it('should automatically rotate keys when needed', () => {
            const clientId = 'test-client';
            apiKeyManager.createKey(clientId);
            apiKeyManager.startRotationInterval();

            // Advance time past rotation interval
            jest.advanceTimersByTime(mockConfig.auth.keyRotationInterval + 1000);

            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.rotation.success');
        });

        it('should stop rotation interval', () => {
            const clientId = 'test-client';
            apiKeyManager.createKey(clientId);
            apiKeyManager.startRotationInterval();
            apiKeyManager.stopRotationInterval();

            // Advance time past rotation interval
            jest.advanceTimersByTime(mockConfig.auth.keyRotationInterval + 1000);

            expect(metrics.increment).not.toHaveBeenCalledWith('auth.apiKey.rotation.success');
        });
    });

    describe('removeKey', () => {
        it('should remove an API key', () => {
            const clientId = 'test-client';
            apiKeyManager.createKey(clientId);
            apiKeyManager.removeKey(clientId);

            expect(apiKeyManager.apiKeys.has(clientId)).toBe(false);
            expect(metrics.increment).toHaveBeenCalledWith('auth.apiKey.removal.success');
        });

        it('should handle non-existent key removal', () => {
            apiKeyManager.removeKey('non-existent');
            expect(metrics.increment).not.toHaveBeenCalledWith('auth.apiKey.removal.success');
        });
    });
}); 