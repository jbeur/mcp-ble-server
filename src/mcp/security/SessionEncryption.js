const crypto = require('crypto');
const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');

class SessionEncryption {
    constructor(config) {
        this.config = config;
        this.algorithm = 'aes-256-gcm';
        this.ivLength = 12; // GCM recommended IV length
        this.authTagLength = 16; // GCM auth tag length
    }

    /**
     * Generate a new encryption key
     * @returns {Buffer} 32-byte encryption key
     */
    generateKey() {
        try {
            const key = crypto.randomBytes(32);
            if (!key || key.length !== 32) {
                throw new Error('Invalid key generated');
            }
            return key;
        } catch (error) {
            logger.error('Failed to generate encryption key:', error);
            throw new Error('Failed to generate encryption key');
        }
    }

    /**
     * Encrypt session data
     * @param {Object} sessionData - Session data to encrypt
     * @param {Buffer} key - Encryption key
     * @returns {Object} Encrypted session data with IV and auth tag
     */
    encryptSession(sessionData, key) {
        try {
            if (!sessionData || !key || !Buffer.isBuffer(key) || key.length !== 32) {
                throw new Error('Invalid input parameters');
            }

            const iv = crypto.randomBytes(this.ivLength);
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);
            
            const dataToEncrypt = JSON.stringify(sessionData);
            let encrypted = cipher.update(dataToEncrypt, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            const authTag = cipher.getAuthTag();
            
            metrics.increment('session.encryption.success');
            
            return {
                encrypted,
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex')
            };
        } catch (error) {
            logger.error('Session encryption failed:', error);
            metrics.increment('session.encryption.error');
            throw new Error('Failed to encrypt session data');
        }
    }

    /**
     * Decrypt session data
     * @param {Object} encryptedData - Encrypted session data
     * @param {Buffer} key - Encryption key
     * @returns {Object} Decrypted session data
     */
    decryptSession(encryptedData, key) {
        try {
            if (!encryptedData || !key || !Buffer.isBuffer(key) || key.length !== 32) {
                throw new Error('Invalid input parameters');
            }

            const { encrypted, iv, authTag } = encryptedData;
            if (!encrypted || !iv || !authTag) {
                throw new Error('Missing required encryption components');
            }
            
            const decipher = crypto.createDecipheriv(
                this.algorithm,
                key,
                Buffer.from(iv, 'hex')
            );
            
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            metrics.increment('session.decryption.success');
            
            return JSON.parse(decrypted);
        } catch (error) {
            logger.error('Session decryption failed:', error);
            metrics.increment('session.decryption.error');
            throw new Error('Failed to decrypt session data');
        }
    }
}

module.exports = SessionEncryption; 