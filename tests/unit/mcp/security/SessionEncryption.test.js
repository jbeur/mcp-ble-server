const SessionEncryption = require('../../../../src/mcp/security/SessionEncryption');
const crypto = require('crypto');

// Update logger mock to include all required methods
jest.mock('../../../../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

// Update metrics mock to include all required methods
jest.mock('../../../../src/utils/metrics', () => ({
  increment: jest.fn(),
  Counter: jest.fn().mockImplementation(() => ({
    inc: jest.fn()
  })),
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn()
  }))
}));

const metrics = require('../../../../src/utils/metrics');
const logger = require('../../../../src/utils/logger');

describe('SessionEncryption', () => {
  let sessionEncryption;
  let mockConfig;
  let mockRandomBytes;
  let randomBytesCallCount = 0;

  beforeEach(() => {
    mockConfig = {
      jwtSecret: 'test-secret-key',
      encryption: {
        algorithm: 'aes-256-gcm'
      }
    };
    
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    sessionEncryption = new SessionEncryption(mockConfig.jwtSecret, metrics);
    randomBytesCallCount = 0;

    // Create a mock implementation that returns different values for each call
    mockRandomBytes = jest.spyOn(crypto, 'randomBytes').mockImplementation((size) => {
      randomBytesCallCount++;
      return Buffer.alloc(size, randomBytesCallCount); // Use call count to generate different values
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (mockRandomBytes) {
      mockRandomBytes.mockRestore();
    }
  });

  describe('constructor', () => {
    it('should initialize with valid JWT secret', () => {
      expect(sessionEncryption).toBeDefined();
      expect(metrics.increment).toHaveBeenCalledWith('session.key.generation.success');
    });

    it('should throw error when JWT secret is missing', () => {
      expect(() => new SessionEncryption(null, metrics)).toThrow('JWT secret is required');
      expect(metrics.increment).toHaveBeenCalledWith('session.key.generation.error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('generateKey', () => {
    it('should generate a 32-byte encryption key', () => {
      const key = sessionEncryption.generateKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
      expect(mockRandomBytes).toHaveBeenCalledWith(32);
    });

    it('should throw error if key generation fails', () => {
      mockRandomBytes.mockImplementation(() => {
        throw new Error('Random bytes generation failed');
      });

      expect(() => sessionEncryption.generateKey()).toThrow('Failed to generate encryption key');
    });
  });

  describe('encryptSession', () => {
    it('should encrypt session data successfully', () => {
      const key = sessionEncryption.generateKey();
      const sessionData = {
        userId: 'test-user',
        permissions: ['read', 'write'],
        expiresAt: Date.now() + 3600000
      };

      const encrypted = sessionEncryption.encryptSession(sessionData, key);

      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted.iv).toMatch(/^[0-9a-f]+$/);
      expect(encrypted.authTag).toMatch(/^[0-9a-f]+$/);
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.success');
    });

    it('should handle invalid session data', () => {
      const key = sessionEncryption.generateKey();
      const invalidData = undefined;

      expect(() => sessionEncryption.encryptSession(invalidData, key))
        .toThrow('Failed to encrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.error');
    });

    it('should handle invalid encryption key', () => {
      const invalidKey = Buffer.from('invalid-key');
      const sessionData = { userId: 'test-user' };

      expect(() => sessionEncryption.encryptSession(sessionData, invalidKey))
        .toThrow('Failed to encrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.error');
    });
  });

  describe('decryptSession', () => {
    it('should decrypt session data successfully', () => {
      const key = sessionEncryption.generateKey();
      const originalData = {
        userId: 'test-user',
        permissions: ['read', 'write'],
        expiresAt: Date.now() + 3600000
      };

      const encrypted = sessionEncryption.encryptSession(originalData, key);
      const decrypted = sessionEncryption.decryptSession(encrypted, key);

      expect(decrypted).toEqual(originalData);
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.success');
    });

    it('should fail to decrypt with wrong key', () => {
      const key1 = crypto.randomBytes(32); // Use real random bytes for this test
      const key2 = crypto.randomBytes(32); // Use real random bytes for this test
      const sessionData = { userId: 'test-user' };

      const encrypted = sessionEncryption.encryptSession(sessionData, key1);

      expect(() => sessionEncryption.decryptSession(encrypted, key2))
        .toThrow('Failed to decrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.error');
    });

    it('should fail to decrypt tampered data', () => {
      const key = sessionEncryption.generateKey();
      const sessionData = { userId: 'test-user' };

      const encrypted = sessionEncryption.encryptSession(sessionData, key);
      encrypted.encrypted = encrypted.encrypted.replace(/[0-9a-f]/, '0');

      expect(() => sessionEncryption.decryptSession(encrypted, key))
        .toThrow('Failed to decrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.error');
    });

    it('should fail to decrypt with missing components', () => {
      const key = sessionEncryption.generateKey();
      const sessionData = { userId: 'test-user' };

      const encrypted = sessionEncryption.encryptSession(sessionData, key);
      delete encrypted.iv;

      expect(() => sessionEncryption.decryptSession(encrypted, key))
        .toThrow('Failed to decrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.error');
    });
  });

  describe('metrics', () => {
    it('should increment success metrics on successful operations', () => {
      const key = sessionEncryption.generateKey();
      const sessionData = { userId: 'test-user' };

      const encrypted = sessionEncryption.encryptSession(sessionData, key);
      sessionEncryption.decryptSession(encrypted, key);

      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.success');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.success');
    });

    it('should increment error metrics on failed operations', () => {
      const key = sessionEncryption.generateKey();
      const invalidData = undefined;

      expect(() => sessionEncryption.encryptSession(invalidData, key))
        .toThrow('Failed to encrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.error');
    });
  });
}); 