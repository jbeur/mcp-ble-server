const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class SessionEncryption {
  constructor(config, metrics) {
    this.config = config || {};
    this.metrics = metrics;
    this.encryptionKey = this.config.security?.encryptionKey;
    this.algorithm = this.config.security?.algorithm || 'aes-256-gcm';
    this.ivLength = this.config.security?.ivLength || 12;
    this.authTagLength = this.config.security?.authTagLength || 16;
  }

  /**
     * Encrypt session data using AES-256-GCM
     * @param {Object} sessionData - The session data to encrypt
     * @returns {Object} Encrypted data with IV and auth tag
     */
  encryptSession(sessionData) {
    try {
      if (!this.encryptionKey) {
        throw new Error('Encryption key not configured');
      }

      // Generate a random IV
      const iv = crypto.randomBytes(this.ivLength);
            
      // Create cipher
      const cipher = crypto.createCipheriv(
        this.algorithm,
        Buffer.from(this.encryptionKey, 'hex'),
        iv
      );

      // Encrypt the data
      const encryptedData = Buffer.concat([
        cipher.update(JSON.stringify(sessionData), 'utf8'),
        cipher.final()
      ]);

      // Get the authentication tag
      const authTag = cipher.getAuthTag();

      const result = {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        encryptedData: encryptedData.toString('hex')
      };

      this.metrics?.sessionEncryptionSuccess?.inc();
      return result;
    } catch (error) {
      logger.error('Failed to encrypt session:', error);
      this.metrics?.sessionEncryptionError?.inc();
      throw error;
    }
  }

  /**
     * Decrypt session data using AES-256-GCM
     * @param {Object} encryptedData - The encrypted data with IV and auth tag
     * @returns {Object} Decrypted session data
     */
  decryptSession(encryptedData) {
    try {
      if (!this.encryptionKey) {
        throw new Error('Encryption key not configured');
      }

      if (!encryptedData || !encryptedData.iv || !encryptedData.authTag || !encryptedData.encryptedData) {
        throw new Error('Invalid encrypted data format');
      }

      // Convert hex strings to buffers
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      const encryptedBuffer = Buffer.from(encryptedData.encryptedData, 'hex');

      // Create decipher
      const decipher = crypto.createDecipheriv(
        this.algorithm,
        Buffer.from(this.encryptionKey, 'hex'),
        iv
      );

      // Set the authentication tag
      decipher.setAuthTag(authTag);

      // Decrypt the data
      const decryptedData = Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final()
      ]);

      const result = JSON.parse(decryptedData.toString('utf8'));

      this.metrics?.sessionDecryptionSuccess?.inc();
      return result;
    } catch (error) {
      logger.error('Failed to decrypt session:', error);
      this.metrics?.sessionDecryptionError?.inc();
      throw error;
    }
  }
}

module.exports = SessionEncryption; 