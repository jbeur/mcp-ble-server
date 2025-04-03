const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { ERROR_CODES } = require('../mcp/protocol/messages');
const SessionEncryption = require('../mcp/security/SessionEncryption');

class AuthService {
    constructor(config, metrics) {
        this.config = config || {};
        this.metrics = metrics;
        this.activeSessions = new Map();
        this.rateLimiters = new Map();
        this.cleanupInterval = null;
        this.sessionEncryption = new SessionEncryption(config);
        this.encryptionKey = this.sessionEncryption.generateKey();
        this.startCleanup();
    }

    async validateApiKey(apiKey) {
        try {
            if (!this.config.auth?.enabled) {
                return { valid: true };
            }

            if (!apiKey) {
                throw new Error('API key is required');
            }

            const isValid = this.config.auth.apiKeys?.includes(apiKey);
            if (!isValid) {
                throw new Error('Invalid API key');
            }

            this.metrics?.authValidationSuccess?.inc();
            return { valid: true };
        } catch (error) {
            logger.error('API key validation failed:', error.message);
            this.metrics?.authValidationError?.inc({ code: 'INVALID_API_KEY' });
            throw error;
        }
    }

    /**
     * Create a new session for a client
     * @param {string} clientId - Client identifier
     * @returns {Object} Session object with token
     */
    createSession(clientId) {
        try {
            if (!clientId) {
                throw new Error('Client ID is required');
            }

            const token = jwt.sign(
                { apiKey: clientId },
                this.config.auth.jwtSecret,
                { expiresIn: this.config.auth.sessionDuration }
            );

            const sessionData = {
                token,
                createdAt: Date.now(),
                lastActivity: Date.now()
            };

            // Encrypt session data before storing
            const encryptedSession = this.sessionEncryption.encryptSession(sessionData, this.encryptionKey);
            this.activeSessions.set(clientId, encryptedSession);

            this.metrics?.authSessionCreationSuccess?.inc();
            return sessionData;
        } catch (error) {
            logger.error('Session creation failed:', error.message);
            this.metrics?.authSessionCreationError?.inc();
            throw error;
        }
    }

    /**
     * Validate a session token
     * @param {string} token - Session token to validate
     * @returns {boolean} True if session is valid
     */
    validateSession(token) {
        try {
            if (!token) {
                return false;
            }

            const decoded = jwt.verify(token, this.config.auth.jwtSecret);
            const encryptedSession = this.activeSessions.get(decoded.apiKey);

            if (!encryptedSession) {
                return false;
            }

            try {
                const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                if (session.token !== token) {
                    return false;
                }

                // Update last activity and re-encrypt
                session.lastActivity = Date.now();
                const updatedEncryptedSession = this.sessionEncryption.encryptSession(session, this.encryptionKey);
                this.activeSessions.set(decoded.apiKey, updatedEncryptedSession);

                return true;
            } catch (decryptError) {
                logger.error('Session decryption failed:', decryptError.message);
                return false;
            }
        } catch (error) {
            logger.error('Error validating session', { error: error.message });
            return false;
        }
    }

    removeSession(clientId) {
        try {
            if (this.activeSessions.delete(clientId)) {
                this.metrics?.authSessionRemovalSuccess?.inc();
            }
        } catch (error) {
            logger.error('Error removing session:', error.message);
            this.metrics?.authSessionRemovalError?.inc();
        }
    }

    /**
     * Start the session cleanup interval
     */
    startCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(() => {
            try {
                const now = Date.now();
                for (const [clientId, encryptedSession] of this.activeSessions.entries()) {
                    try {
                        const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                        const age = now - session.lastActivity;
                        if (age > this.config.auth.sessionTimeout) {
                            this.removeSession(clientId);
                            this.metrics?.authSessionCleanupSuccess?.inc();
                        }
                    } catch (decryptError) {
                        logger.error('Failed to decrypt session during cleanup:', decryptError.message);
                        this.removeSession(clientId);
                        this.metrics?.authSessionCleanupError?.inc();
                    }
                }
            } catch (error) {
                logger.error('Session cleanup error:', error.message);
                this.metrics?.authSessionCleanupError?.inc();
            }
        }, this.config.auth.cleanupInterval || 300000); // Default to 5 minutes
    }

    /**
     * Stop the session cleanup interval
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Clean up expired sessions
     */
    cleanup() {
        try {
            const now = Date.now();
            for (const [clientId, encryptedSession] of this.activeSessions.entries()) {
                try {
                    const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                    const age = now - session.lastActivity;
                    if (age > this.config.auth.sessionTimeout) {
                        this.removeSession(clientId);
                        this.metrics?.authSessionCleanupSuccess?.inc();
                    }
                } catch (decryptError) {
                    logger.error('Failed to decrypt session during cleanup:', decryptError.message);
                    this.removeSession(clientId);
                    this.metrics?.authSessionCleanupError?.inc();
                }
            }
        } catch (error) {
            logger.error('Session cleanup error:', error.message);
            this.metrics?.authSessionCleanupError?.inc();
        }
    }

    isRateLimited(key) {
        try {
            if (!this.config.auth?.rateLimit?.enabled) {
                return false;
            }

            const now = Date.now();
            let limiter = this.rateLimiters.get(key);

            if (!limiter) {
                limiter = {
                    count: 0,
                    lastReset: now
                };
                this.rateLimiters.set(key, limiter);
            }

            // Reset counter if window has expired
            if (now - limiter.lastReset > this.config.auth.rateLimit.windowMs) {
                limiter.count = 0;
                limiter.lastReset = now;
            }

            limiter.count++;
            const isLimited = limiter.count > this.config.auth.rateLimit.maxRequests;

            if (isLimited) {
                this.metrics?.authRateLimitExceeded?.inc();
            } else {
                this.metrics?.authRateLimitCheckSuccess?.inc();
            }

            return isLimited;
        } catch (error) {
            logger.error('Error checking rate limit', { error: error.message, key });
            return false; // Fail open on error
        }
    }
}

module.exports = AuthService; 