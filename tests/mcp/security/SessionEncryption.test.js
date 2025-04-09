const SessionEncryption = require('../../../src/mcp/security/SessionEncryption');
const logger = require('../../../src/utils/logger');
const metrics = require('../../../src/utils/metrics');

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/metrics');

describe('SessionEncryption', () => {
  let sessionEncryption;
  const jwtSecret = 'test-secret';

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup logger mock
    logger.error = jest.fn();
    logger.info = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();

    // Setup metrics mock
    metrics.increment = jest.fn();

    // Create session encryption instance
    sessionEncryption = new SessionEncryption(jwtSecret, metrics);
  });

  describe('constructor', () => {
    it('should initialize with provided JWT secret', () => {
      const encryption = new SessionEncryption(jwtSecret, metrics);
      expect(encryption.key).toBeDefined();
      expect(encryption.algorithm).toBe('aes-256-gcm');
      expect(encryption.ivLength).toBe(12);
      expect(encryption.authTagLength).toBe(16);
      expect(metrics.increment).toHaveBeenCalledWith('session.key.generation.success');
    });

    it('should initialize with default secret if not provided', () => {
      const encryption = new SessionEncryption(null, metrics);
      expect(encryption.key).toBeDefined();
      expect(metrics.increment).toHaveBeenCalledWith('session.key.generation.success');
    });

    it('should initialize with default metrics if not provided', () => {
      const encryption = new SessionEncryption(jwtSecret);
      expect(encryption.metrics).toBeDefined();
      expect(typeof encryption.metrics.increment).toBe('function');
    });
  });

  describe('encryptSession', () => {
    it('should encrypt session data successfully', async () => {
      const sessionData = {
        id: 'test-session',
        userId: 'test-user',
        expiresAt: Date.now() + 3600000
      };

      const encrypted = await sessionEncryption.encryptSession(sessionData);

      expect(encrypted).toBeDefined();
      expect(encrypted.encrypted).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.success');
    });

    it('should throw error if key is not initialized', async () => {
      sessionEncryption.key = null;
      const sessionData = { id: 'test-session' };

      await expect(sessionEncryption.encryptSession(sessionData))
        .rejects.toThrow('Failed to encrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.error');
    });

    it('should handle encryption errors gracefully', async () => {
      const sessionData = { id: 'test-session' };
      // Mock crypto.createCipheriv to throw error
      jest.spyOn(require('crypto'), 'createCipheriv').mockImplementation(() => {
        throw new Error('Encryption failed');
      });

      await expect(sessionEncryption.encryptSession(sessionData))
        .rejects.toThrow('Failed to encrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.encryption.error');
    });
  });

  describe('decryptSession', () => {
    it('should decrypt session data successfully', async () => {
      const sessionData = {
        id: 'test-session',
        userId: 'test-user',
        expiresAt: Date.now() + 3600000
      };

      // First encrypt the data
      const encrypted = await sessionEncryption.encryptSession(sessionData);
      
      // Then decrypt it
      const decrypted = await sessionEncryption.decryptSession(encrypted);

      expect(decrypted).toEqual(sessionData);
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.success');
    });

    it('should throw error if key is not initialized', async () => {
      sessionEncryption.key = null;
      const encryptedData = {
        encrypted: 'test',
        iv: 'test',
        authTag: 'test'
      };

      await expect(sessionEncryption.decryptSession(encryptedData))
        .rejects.toThrow('Failed to decrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.error');
    });

    it('should throw error for invalid encrypted data', async () => {
      const invalidData = {
        encrypted: 'invalid',
        iv: 'invalid',
        authTag: 'invalid'
      };

      await expect(sessionEncryption.decryptSession(invalidData))
        .rejects.toThrow('Failed to decrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.error');
    });

    it('should handle decryption errors gracefully', async () => {
      const encryptedData = {
        encrypted: 'test',
        iv: 'test',
        authTag: 'test'
      };

      // Mock crypto.createDecipheriv to throw error
      jest.spyOn(require('crypto'), 'createDecipheriv').mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await expect(sessionEncryption.decryptSession(encryptedData))
        .rejects.toThrow('Failed to decrypt session data');
      expect(metrics.increment).toHaveBeenCalledWith('session.decryption.error');
    });
  });

  describe('generateKey', () => {
    it('should generate new encryption key successfully', async () => {
      const oldKey = sessionEncryption.key;
      const newKey = await sessionEncryption.generateKey();

      expect(newKey).toBeDefined();
      expect(newKey).not.toEqual(oldKey);
      expect(metrics.increment).toHaveBeenCalledWith('session.key.generation.success');
    });

    it('should handle key generation errors gracefully', async () => {
      // Mock crypto.randomBytes to throw error
      jest.spyOn(require('crypto'), 'randomBytes').mockImplementation(() => {
        throw new Error('Key generation failed');
      });

      await expect(sessionEncryption.generateKey())
        .rejects.toThrow('Failed to generate encryption key');
      expect(metrics.increment).toHaveBeenCalledWith('session.key.generation.error');
    });
  });

  describe('end-to-end encryption', () => {
    it('should successfully encrypt and decrypt complex session data', async () => {
      const complexData = {
        id: 'test-session',
        user: {
          id: 'test-user',
          roles: ['admin', 'user'],
          preferences: {
            theme: 'dark',
            notifications: true
          }
        },
        metadata: {
          createdAt: new Date().toISOString(),
          lastAccess: new Date().toISOString(),
          accessCount: 42
        },
        permissions: new Set(['read', 'write']),
        tags: ['important', 'secure']
      };

      const encrypted = await sessionEncryption.encryptSession(complexData);
      const decrypted = await sessionEncryption.decryptSession(encrypted);

      // Convert Set to Array for comparison
      complexData.permissions = Array.from(complexData.permissions);

      expect(decrypted).toEqual(complexData);
    });

    it('should maintain data integrity across multiple encryption cycles', async () => {
      const originalData = {
        id: 'test-session',
        counter: 0
      };

      let currentData = originalData;
      
      // Perform multiple encryption/decryption cycles
      for (let i = 0; i < 10; i++) {
        currentData.counter = i;
        const encrypted = await sessionEncryption.encryptSession(currentData);
        currentData = await sessionEncryption.decryptSession(encrypted);
      }

      expect(currentData.id).toBe(originalData.id);
      expect(currentData.counter).toBe(9);
    });
  });
}); 