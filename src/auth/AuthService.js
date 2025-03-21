const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const { metrics } = require('../utils/metrics');

class AuthService {
    constructor(config, metrics) {
        this.activeSessions = new Map();
        this.rateLimiters = new Map();
        this.config = config || {
            auth: {
                enabled: true,
                apiKeys: ['valid-api-key'],
                jwtSecret: 'test-secret',
                sessionDuration: 3600,
                rateLimit: {
                    windowMs: 5000, // 5 seconds for testing
                    maxRequests: 5 // 5 requests per window for testing
                }
            }
        };
        this.metrics = metrics || {
            authError: { inc: () => {} },
            authSuccess: { inc: () => {} },
            rateLimitExceeded: { inc: () => {} },
            authSessionCreationSuccess: { inc: () => {} },
            authSessionCreationError: { inc: () => {} },
            authSessionRemovalSuccess: { inc: () => {} },
            authSessionRemovalError: { inc: () => {} },
            authCleanupSuccess: { inc: () => {} },
            authRateLimitExceeded: { inc: () => {} },
            authRateLimitCheckSuccess: { inc: () => {} }
        };

        // Start cleanup interval
        this.cleanupInterval = setInterval(() => this.cleanup(), 1000);
    }

    validateApiKey(apiKey) {
        try {
            if (!this.config.auth.enabled) {
                this.metrics.authSuccess.inc();
                return { valid: true };
            }

            if (!apiKey) {
                const error = new Error('API key is required');
                error.code = 'INVALID_API_KEY';
                this.metrics.authError.inc({ code: 'INVALID_API_KEY' });
                throw error;
            }

            // Check rate limit first
            const isLimited = this.isRateLimited(apiKey);
            if (isLimited) {
                const error = new Error('Too many authentication attempts');
                error.code = 'RATE_LIMIT_EXCEEDED';
                this.metrics.rateLimitExceeded.inc({ key: apiKey });
                throw error;
            }

            const isValid = this.config.auth.apiKeys.includes(apiKey);
            if (isValid) {
                this.metrics.authSuccess.inc();
                return { valid: true };
            }

            this.metrics.authError.inc({ code: 'INVALID_API_KEY' });
            const error = new Error('Invalid API key');
            error.code = 'INVALID_API_KEY';
            throw error;
        } catch (error) {
            logger.error('API key validation failed:', error.message);
            throw error;
        }
    }

    createSession(clientId) {
        try {
            if (!clientId) {
                this.metrics.authSessionCreationError.inc();
                throw new Error('Client ID is required');
            }

            const token = jwt.sign(
                { clientId },
                this.config.auth.jwtSecret,
                { expiresIn: `${this.config.auth.sessionDuration}s` }
            );

            const session = {
                clientId,
                token,
                createdAt: Date.now(),
                lastActivity: Date.now()
            };

            this.activeSessions.set(clientId, session);
            this.metrics.authSessionCreationSuccess.inc();

            return session;
        } catch (error) {
            logger.error('Error creating session', { error, clientId });
            this.metrics.authSessionCreationError.inc();
            throw error;
        }
    }

    isAuthenticated(clientId) {
        try {
            const session = this.activeSessions.get(clientId);
            if (!session) {
                return false;
            }

            try {
                jwt.verify(session.token, this.config.auth.jwtSecret);
                session.lastActivity = Date.now();
                this.activeSessions.set(clientId, session);
                return true;
            } catch (error) {
                this.removeSession(clientId);
                return false;
            }
        } catch (error) {
            logger.error('Error checking authentication', { error, clientId });
            return false;
        }
    }

    removeSession(clientId) {
        try {
            this.activeSessions.delete(clientId);
            this.metrics.authSessionRemovalSuccess.inc();
        } catch (error) {
            logger.error('Error removing session', { error, clientId });
            this.metrics.authSessionRemovalError.inc();
        }
    }

    cleanup() {
        try {
            const now = Date.now();
            
            // Cleanup expired sessions
            if (this.activeSessions) {
                for (const [clientId, session] of this.activeSessions.entries()) {
                    if (session && now - session.createdAt > this.config.auth.sessionDuration * 1000) {
                        this.removeSession(clientId);
                    }
                }
            }

            // Cleanup expired rate limits
            if (this.rateLimiters) {
                for (const [key, limit] of this.rateLimiters.entries()) {
                    if (limit && now - limit.timestamp > this.config.auth.rateLimit.windowMs) {
                        this.rateLimiters.delete(key);
                    }
                }
            }

            this.metrics.authCleanupSuccess.inc();
        } catch (error) {
            logger.error('Error cleaning up expired sessions', { 
                error: error.message || 'Unknown error',
                timestamp: new Date().toISOString()
            });
            this.metrics.authError.inc({ code: 'CLEANUP_ERROR' });
        }
    }

    isRateLimited(key) {
        const now = Date.now();
        const rateLimiter = this.rateLimiters.get(key) || { count: 0, timestamp: now };

        // Reset rate limit if time window has passed
        if (now - rateLimiter.timestamp >= this.config.auth.rateLimit.windowMs) {
            rateLimiter.count = 0;
            rateLimiter.timestamp = now;
        }

        // Increment request count
        rateLimiter.count++;
        this.rateLimiters.set(key, rateLimiter);

        // Check if rate limit is exceeded
        if (rateLimiter.count > this.config.auth.rateLimit.maxRequests) {
            this.metrics.authRateLimitExceeded.inc();
            logger.warn('Rate limit exceeded', {
                key,
                count: rateLimiter.count,
                maxRequests: this.config.auth.rateLimit.maxRequests,
                windowMs: this.config.auth.rateLimit.windowMs,
                timestamp: new Date().toISOString()
            });

            return true;
        }

        this.metrics.authRateLimitCheckSuccess.inc();
        return false;
    }

    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

module.exports = AuthService; 