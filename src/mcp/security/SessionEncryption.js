const crypto = require('crypto');
const logger = require('../../utils/logger');

class SessionEncryption {
  constructor(jwtSecret, metrics) {
    // Initialize metrics first to ensure it's available
    this.metrics = metrics;

    // Initialize properties
    this.algorithm = 'aes-256-gcm';
    this.key = null;

    // Check JWT secret before any key generation
    if (!jwtSecret) {
      if (this.metrics) {
        this.metrics.increment('session.key.generation.error');
      }
      logger.error('JWT secret is required for session encryption');
      throw new Error('JWT secret is required');
    }

    // Store JWT secret and generate key
    this.jwtSecret = jwtSecret;
    this.key = this.generateKey();
  }

  generateKey() {
    try {
      const key = crypto.randomBytes(32);
      if (this.metrics) {
        this.metrics.increment('session.key.generation.success');
      }
      return key;
    } catch (error) {
      logger.error('Failed to generate encryption key:', error);
      if (this.metrics) {
        this.metrics.increment('session.key.generation.error');
      }
      throw new Error('Failed to generate encryption key');
    }
  }

  encryptSession(sessionData, key) {
    try {
      if (!sessionData || typeof sessionData !== 'object') {
        throw new Error('Failed to encrypt session data');
      }

      const encryptionKey = key || this.key;
      if (!encryptionKey || !(encryptionKey instanceof Buffer)) {
        throw new Error('Failed to encrypt session data');
      }

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(this.algorithm, encryptionKey, iv);
      
      const encryptedData = Buffer.concat([
        cipher.update(JSON.stringify(sessionData), 'utf8'),
        cipher.final()
      ]);

      const authTag = cipher.getAuthTag();

      if (this.metrics) {
        this.metrics.increment('session.encryption.success');
      }
      return {
        encrypted: encryptedData.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      logger.error('Session encryption failed:', error);
      if (this.metrics) {
        this.metrics.increment('session.encryption.error');
      }
      throw new Error('Failed to encrypt session data');
    }
  }

  decryptSession(encryptedData, key) {
    try {
      if (!encryptedData || !encryptedData.encrypted || !encryptedData.iv || !encryptedData.authTag) {
        throw new Error('Failed to decrypt session data');
      }

      const decryptionKey = key || this.key;
      if (!decryptionKey || !(decryptionKey instanceof Buffer)) {
        throw new Error('Failed to decrypt session data');
      }

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        decryptionKey,
        Buffer.from(encryptedData.iv, 'hex')
      );

      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

      const decryptedData = Buffer.concat([
        decipher.update(Buffer.from(encryptedData.encrypted, 'hex')),
        decipher.final()
      ]);

      const sessionData = JSON.parse(decryptedData.toString('utf8'));

      if (!sessionData || typeof sessionData !== 'object') {
        throw new Error('Failed to decrypt session data');
      }

      if (this.metrics) {
        this.metrics.increment('session.decryption.success');
      }
      return sessionData;
    } catch (error) {
      logger.error('Session decryption failed:', error);
      if (this.metrics) {
        this.metrics.increment('session.decryption.error');
      }
      throw new Error('Failed to decrypt session data');
    }
  }
}

module.exports = SessionEncryption; 