const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const { ERROR_CODES } = require('../mcp/protocol/messages');

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
                    windowMs: 60000, // 1 minute for testing
                    maxRequests: 5 // 5 requests per minute for testing
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

    async validateApiKey(apiKey) {
        try {
            if (!this.config.auth.enabled) {
                this.metrics.authSuccess.inc();
                return this.createSession(apiKey);
            }

            if (!apiKey) {
                const error = new Error('API key is required');
                error.code = ERROR_CODES.INVALID_API_KEY;
                this.metrics.authError.inc({ code: ERROR_CODES.INVALID_API_KEY });
                throw error;
            }

            // Check rate limit first
            if (this.isRateLimited(apiKey)) {
                const error = new Error('Too many authentication attempts');
                error.code = ERROR_CODES.RATE_LIMIT_EXCEEDED;
                this.metrics.rateLimitExceeded.inc({ key: apiKey });
                throw error;
            }

            const isValid = this.config.auth.apiKeys.includes(apiKey);
            if (isValid) {
                this.metrics.authSuccess.inc();
                return this.createSession(apiKey);
            }

            this.metrics.authError.inc({ code: ERROR_CODES.INVALID_API_KEY });
            const error = new Error('Invalid API key');
            error.code = ERROR_CODES.INVALID_API_KEY;
            throw error;
        } catch (error) {
            logger.error('API key validation failed:', error.message);
            throw error;
        }
    }

    createSession(apiKey) {
        try {
            if (!apiKey) {
                const error = new Error('API key is required');
                error.code = ERROR_CODES.INVALID_API_KEY;
                this.metrics.authSessionCreationError.inc();
                throw error;
            }

            const token = jwt.sign(
                { apiKey },
                this.config.auth.jwtSecret,
                { expiresIn: `${this.config.auth.sessionDuration}s` }
            );

            const session = {
                apiKey,
                token,
                createdAt: Date.now(),
                expiresAt: Date.now() + (this.config.auth.sessionDuration * 1000),
                lastActivity: Date.now()
            };

            this.activeSessions.set(apiKey, session);
            this.metrics.authSessionCreationSuccess.inc();

            return session;
        } catch (error) {
            logger.error('Error creating session', { error, apiKey });
            this.metrics.authSessionCreationError.inc();
            throw error;
        }
    }

    validateSession(token) {
        try {
            if (!token) {
                return false;
            }

            let decoded;
            try {
                decoded = jwt.verify(token, this.config.auth.jwtSecret);
            } catch (error) {
                logger.error('JWT verification failed', { error });
                return false;
            }

            const session = this.activeSessions.get(decoded.apiKey);
            if (!session || session.token !== token || session.expiresAt < Date.now()) {
                if (session) {
                    this.removeSession(decoded.apiKey);
                }
                return false;
            }

            // Update last activity
            session.lastActivity = Date.now();
            this.activeSessions.set(decoded.apiKey, session);
            return true;
        } catch (error) {
            logger.error('Error validating session', { error });
            return false;
        }
    }

    removeSession(apiKey) {
        try {
            if (this.activeSessions.has(apiKey)) {
                this.activeSessions.delete(apiKey);
                this.metrics.authSessionRemovalSuccess.inc();
            }
        } catch (error) {
            logger.error('Error removing session', { error, apiKey });
            this.metrics.authSessionRemovalError.inc();
        }
    }

    cleanup() {
        try {
            const now = Date.now();
            
            // Cleanup expired sessions
            for (const [apiKey, session] of this.activeSessions.entries()) {
                if (session && now > session.expiresAt) {
                    this.removeSession(apiKey);
                }
            }

            // Cleanup expired rate limits
            for (const [key, limit] of this.rateLimiters.entries()) {
                if (limit && now - limit.timestamp > this.config.auth.rateLimit.windowMs) {
                    this.rateLimiters.delete(key);
                }
            }

            this.metrics.authCleanupSuccess.inc();
        } catch (error) {
            logger.error('Error cleaning up expired sessions', { 
                error: error.message || 'Unknown error',
                timestamp: new Date().toISOString()
            });
            this.metrics.authError.inc({ code: ERROR_CODES.PROCESSING_ERROR });
        }
    }

    isRateLimited(key) {
        try {
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
        } catch (error) {
            logger.error('Error checking rate limit', { error: error.message || error, key });
            return false; // Fail open on error
        }
    }

    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

module.exports = AuthService; 