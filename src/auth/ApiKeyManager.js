const crypto = require('crypto');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class ApiKeyManager {
    constructor(config, metrics) {
        this.config = config || {};
        this.metrics = metrics || {
            increment: (name) => {
                logger.info(`Metric incremented: ${name}`);
            }
        };
        this.apiKeys = new Map(); // Map of clientId to { key, createdAt, lastRotated }
        this.rotationInterval = this.config.auth?.keyRotationInterval || 24 * 60 * 60 * 1000; // Default 24 hours
        this.maxKeyAge = this.config.auth?.maxKeyAge || 7 * 24 * 60 * 60 * 1000; // Default 7 days
        this.rotationIntervalId = null;
    }

    /**
     * Generate a new API key
     * @returns {string} Generated API key
     */
    generateKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Create a new API key for a client
     * @param {string} clientId - Client identifier
     * @returns {string} Generated API key
     */
    createKey(clientId) {
        try {
            if (!clientId) {
                throw new Error('Client ID is required');
            }

            const key = this.generateKey();
            const now = Date.now();

            this.apiKeys.set(clientId, {
                key,
                createdAt: now,
                lastRotated: now
            });

            this.metrics.increment('auth.apiKey.creation.success');
            return key;
        } catch (error) {
            logger.error('API key creation failed:', error);
            this.metrics.increment('auth.apiKey.creation.error');
            throw error;
        }
    }

    /**
     * Rotate an API key for a client
     * @param {string} clientId - Client identifier
     * @returns {string} New API key
     */
    rotateKey(clientId) {
        try {
            if (!this.apiKeys.has(clientId)) {
                throw new Error('Client does not have an API key');
            }

            const newKey = this.generateKey();
            const now = Date.now();
            const currentKey = this.apiKeys.get(clientId);

            this.apiKeys.set(clientId, {
                key: newKey,
                createdAt: currentKey.createdAt,
                lastRotated: now
            });

            this.metrics.increment('auth.apiKey.rotation.success');
            return newKey;
        } catch (error) {
            logger.error('API key rotation failed:', error);
            this.metrics.increment('auth.apiKey.rotation.error');
            throw error;
        }
    }

    /**
     * Validate an API key
     * @param {string} clientId - Client identifier
     * @param {string} key - API key to validate
     * @returns {boolean} True if key is valid
     */
    validateKey(clientId, key) {
        try {
            if (!this.apiKeys.has(clientId)) {
                return false;
            }

            const apiKeyData = this.apiKeys.get(clientId);
            const isValid = apiKeyData.key === key;

            if (isValid) {
                this.metrics.increment('auth.apiKey.validation.success');
            } else {
                this.metrics.increment('auth.apiKey.validation.error');
            }

            return isValid;
        } catch (error) {
            logger.error('API key validation failed:', error);
            this.metrics.increment('auth.apiKey.validation.error');
            return false;
        }
    }

    /**
     * Check if a key needs rotation
     * @param {string} clientId - Client identifier
     * @returns {boolean} True if key needs rotation
     */
    needsRotation(clientId) {
        try {
            if (!this.apiKeys.has(clientId)) {
                return false;
            }

            const apiKeyData = this.apiKeys.get(clientId);
            const now = Date.now();
            const timeSinceLastRotation = now - apiKeyData.lastRotated;
            const totalAge = now - apiKeyData.createdAt;

            return timeSinceLastRotation >= this.rotationInterval || totalAge >= this.maxKeyAge;
        } catch (error) {
            logger.error('Key rotation check failed:', error);
            return false;
        }
    }

    /**
     * Start the key rotation interval
     */
    startRotationInterval() {
        if (this.rotationIntervalId) {
            clearInterval(this.rotationIntervalId);
        }

        this.rotationIntervalId = setInterval(() => {
            try {
                for (const [clientId] of this.apiKeys.entries()) {
                    if (this.needsRotation(clientId)) {
                        this.rotateKey(clientId);
                    }
                }
            } catch (error) {
                logger.error('Key rotation interval error:', error);
            }
        }, Math.min(this.rotationInterval, this.maxKeyAge));
    }

    /**
     * Stop the key rotation interval
     */
    stopRotationInterval() {
        if (this.rotationIntervalId) {
            clearInterval(this.rotationIntervalId);
            this.rotationIntervalId = null;
        }
    }

    /**
     * Remove an API key
     * @param {string} clientId - Client identifier
     */
    removeKey(clientId) {
        try {
            if (this.apiKeys.delete(clientId)) {
                this.metrics.increment('auth.apiKey.removal.success');
            }
        } catch (error) {
            logger.error('API key removal failed:', error);
            this.metrics.increment('auth.apiKey.removal.error');
        }
    }

    /**
     * Clean up API keys
     */
    async cleanup() {
        try {
            // Stop rotation interval if it exists
            if (this.rotationIntervalId) {
                clearInterval(this.rotationIntervalId);
                this.rotationIntervalId = null;
            }
            
            // Clear all API keys
            this.apiKeys.clear();
            
            logger.info('ApiKeyManager cleanup completed');
        } catch (error) {
            logger.error('Error during ApiKeyManager cleanup:', error);
            throw error;
        }
    }

    /**
     * Stop the service and clean up resources
     */
    async stop() {
        try {
            // Stop rotation interval if it exists
            if (this.rotationIntervalId) {
                clearInterval(this.rotationIntervalId);
                this.rotationIntervalId = null;
            }
            
            await this.cleanup();
            logger.info('ApiKeyManager stopped');
        } catch (error) {
            logger.error('Error stopping ApiKeyManager:', error);
            throw error;
        }
    }
}

module.exports = ApiKeyManager; 