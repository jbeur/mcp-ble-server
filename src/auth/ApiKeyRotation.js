const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class ApiKeyRotation {
  constructor(config, metrics) {
    this.config = config || {};
    this.metrics = metrics;
    this.keyStore = new Map(); // clientId -> array of {key, createdAt, expiresAt}
        
    // Configuration
    this.apiKeyLength = this.config.security?.apiKeyLength || 32;
    this.rotationInterval = this.config.security?.rotationInterval || 24 * 60 * 60; // 24 hours in seconds
    this.gracePeriod = this.config.security?.gracePeriod || 60 * 60; // 1 hour in seconds
    this.maxKeys = this.config.security?.maxKeys || 2; // Maximum number of valid keys per client
  }

  /**
     * Generate a new API key for a client
     * @param {string} clientId - The client identifier
     * @returns {Object} API key object with metadata
     */
  generateApiKey(clientId) {
    try {
      if (!clientId) {
        throw new Error('Invalid client ID');
      }

      const key = crypto.randomBytes(this.apiKeyLength).toString('hex');
      const now = Date.now();
      const apiKey = {
        key,
        clientId,
        createdAt: now,
        expiresAt: now + (this.rotationInterval * 1000)
      };

      // Store the key and enforce max keys limit
      let clientKeys = this.keyStore.get(clientId) || [];
      clientKeys.push(apiKey);
            
      // Keep only the most recent keys up to maxKeys
      if (clientKeys.length > this.maxKeys) {
        clientKeys = clientKeys.slice(-this.maxKeys);
      }
            
      this.keyStore.set(clientId, clientKeys);

      this.metrics?.apiKeyRotationSuccess?.inc();
      return apiKey;
    } catch (error) {
      logger.error('Failed to generate API key:', error);
      this.metrics?.apiKeyRotationError?.inc();
      throw error;
    }
  }

  /**
     * Rotate API key for a client
     * @param {string} clientId - The client identifier
     * @returns {Object} New API key object
     */
  rotateApiKey(clientId) {
    try {
      // Clean up old keys before generating new one
      this.cleanup(clientId);

      // Generate new key
      const newKey = this.generateApiKey(clientId);

      return newKey;
    } catch (error) {
      logger.error('Failed to rotate API key:', error);
      this.metrics?.apiKeyRotationError?.inc();
      throw error;
    }
  }

  /**
     * Validate an API key
     * @param {string} clientId - The client identifier
     * @param {string} key - The API key to validate
     * @returns {boolean} Whether the key is valid
     */
  isValidKey(clientId, key) {
    try {
      const clientKeys = this.keyStore.get(clientId);
      if (!clientKeys) {
        this.metrics?.apiKeyValidationError?.inc();
        return false;
      }

      // Find matching key
      const keyData = clientKeys.find(k => k.key === key);
      if (!keyData) {
        this.metrics?.apiKeyValidationError?.inc();
        return false;
      }

      // Check if key is within maxKeys most recent keys
      const keyIndex = clientKeys.indexOf(keyData);
      if (keyIndex < clientKeys.length - this.maxKeys) {
        this.metrics?.apiKeyValidationError?.inc();
        return false;
      }

      // Check expiration
      const now = Date.now();
      if (now > keyData.expiresAt) {
        // If key is expired, clean it up and return false
        this.cleanup(clientId);
        this.metrics?.apiKeyValidationError?.inc();
        return false;
      }

      this.metrics?.apiKeyValidationSuccess?.inc();
      return true;
    } catch (error) {
      logger.error('Failed to validate API key:', error);
      this.metrics?.apiKeyValidationError?.inc();
      return false;
    }
  }

  /**
     * Clean up expired keys for a client or all clients
     * @param {string} [clientId] - Optional client identifier
     */
  cleanup(clientId) {
    try {
      const now = Date.now();
            
      if (clientId) {
        // Clean up specific client
        const clientKeys = this.keyStore.get(clientId);
        if (clientKeys) {
          const validKeys = clientKeys
            .filter(k => now <= k.expiresAt)
            .slice(-this.maxKeys); // Keep only the most recent valid keys
          if (validKeys.length === 0) {
            this.keyStore.delete(clientId);
          } else {
            this.keyStore.set(clientId, validKeys);
          }
        }
      } else {
        // Clean up all clients
        for (const [id, keys] of this.keyStore.entries()) {
          const validKeys = keys
            .filter(k => now <= k.expiresAt)
            .slice(-this.maxKeys);
                    
          if (validKeys.length === 0) {
            this.keyStore.delete(id);
          } else {
            this.keyStore.set(id, validKeys);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup API keys:', error);
    }
  }
}

module.exports = ApiKeyRotation; 