const crypto = require('crypto');
const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class SessionEncryption {
    constructor(jwtSecret, metrics) {
        this.metrics = metrics || {
            increment: (name) => {
                logger.info(`Metric incremented: ${name}`);
            }
        };

        // Use JWT secret to derive encryption key
        const hash = crypto.createHash('sha256');
        hash.update(jwtSecret || 'default-secret-key');
        this.key = hash.digest();

        this.algorithm = 'aes-256-gcm';
        this.ivLength = 12; // GCM recommended IV length
        this.authTagLength = 16; // GCM auth tag length

        this.metrics.increment('session.key.generation.success');
    }

    /**
     * Encrypt session data
     * @param {Object} sessionData - Session data to encrypt
     * @returns {Promise<string>} Encrypted session data
     */
    async encryptSession(sessionData) {
        try {
            if (!this.key) {
                throw new Error('Encryption key not initialized');
            }

            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
            
            let encrypted = cipher.update(JSON.stringify(sessionData), 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            const authTag = cipher.getAuthTag();
            
            const result = {
                encrypted,
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex')
            };

            this.metrics.increment('session.encryption.success');
            return result;
        } catch (error) {
            this.metrics.increment('session.encryption.error');
            logger.error('Session encryption failed:', error);
            throw new Error('Failed to encrypt session data');
        }
    }

    /**
     * Decrypt session data
     * @param {string} encryptedData - Encrypted session data
     * @returns {Promise<Object>} Decrypted session data
     */
    async decryptSession(encryptedData) {
        try {
            if (!this.key) {
                throw new Error('Encryption key not initialized');
            }

            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                this.key,
                Buffer.from(encryptedData.iv, 'hex')
            );

            decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            this.metrics.increment('session.decryption.success');
            return JSON.parse(decrypted);
        } catch (error) {
            this.metrics.increment('session.decryption.error');
            logger.error('Session decryption failed:', error);
            throw new Error('Failed to decrypt session data');
        }
    }

    /**
     * Generate a new encryption key
     * @returns {Promise<string>} Generated encryption key
     */
    async generateKey() {
        try {
            // Generate a random 32-byte key for AES-256
            this.key = crypto.randomBytes(32);
            this.metrics.increment('session.key.generation.success');
            return this.key;
        } catch (error) {
            this.metrics.increment('session.key.generation.error');
            logger.error('Key generation failed:', error);
            throw new Error('Failed to generate encryption key');
        }
    }
}

module.exports = SessionEncryption; 