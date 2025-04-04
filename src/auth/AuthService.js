const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { ERROR_CODES } = require('../mcp/protocol/messages');
const SessionEncryption = require('../mcp/security/SessionEncryption');
const ApiKeyManager = require('./ApiKeyManager');
const TokenAuthentication = require('./TokenAuthentication');
const OAuth2Service = require('./OAuth2Service');

class AuthService {
    constructor(config, metrics) {
        this.config = config || {};
        this.metrics = metrics;
        this.activeSessions = new Map();
        this.rateLimiters = new Map();
        this.cleanupInterval = null;
        this.sessionEncryption = new SessionEncryption(config);
        this.encryptionKey = this.sessionEncryption.generateKey();
        this.apiKeyManager = new ApiKeyManager(config);
        this.tokenAuth = new TokenAuthentication(config, metrics);
        this.oauth2Service = new OAuth2Service(config, metrics);
        this.startCleanup();
        this.apiKeyManager.startRotationInterval();
    }

    /**
     * Validate an API key
     * @param {string} apiKey - API key to validate
     * @returns {Promise<Object>} Validation result
     */
    async validateApiKey(apiKey) {
        try {
            if (!apiKey) {
                this.metrics?.authValidationError?.inc();
                throw new Error('API key is required');
            }

            const isValid = this.apiKeyManager.validateKey(apiKey);
            if (!isValid) {
                this.metrics?.authValidationError?.inc();
                throw new Error('Invalid API key');
            }

            this.metrics?.authValidationSuccess?.inc();
            return { valid: true };
        } catch (error) {
            logger.error('API key validation failed:', error.message);
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

            // Create or get API key for the client
            const apiKey = this.apiKeyManager.createKey(clientId);

            const token = jwt.sign(
                { apiKey, clientId },
                this.config.auth.jwtSecret,
                { expiresIn: this.config.auth.sessionDuration }
            );

            const sessionData = {
                token,
                apiKey,
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
            const encryptedSession = this.activeSessions.get(decoded.clientId);

            if (!encryptedSession) {
                return false;
            }

            try {
                const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                
                // Validate API key
                if (!this.apiKeyManager.validateKey(decoded.clientId, session.apiKey)) {
                    return false;
                }

                if (session.token !== token) {
                    return false;
                }

                // Update last activity and re-encrypt
                session.lastActivity = Date.now();
                const updatedEncryptedSession = this.sessionEncryption.encryptSession(session, this.encryptionKey);
                this.activeSessions.set(decoded.clientId, updatedEncryptedSession);

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
                this.apiKeyManager.removeKey(clientId);
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
        // Clear any existing interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Start new cleanup interval
        this.cleanupInterval = setInterval(() => {
            try {
                this.cleanupSessions();
                this.metrics?.authSessionCleanupSuccess?.inc();
            } catch (error) {
                logger.error('Session cleanup failed:', error);
                this.metrics?.authSessionCleanupError?.inc();
            }
        }, this.config.security?.auth?.cleanupInterval || 300000); // Default to 5 minutes
    }

    /**
     * Stop the cleanup interval
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.apiKeyManager.stopRotationInterval();
    }

    /**
     * Clean up expired sessions
     */
    cleanupSessions() {
        const now = Date.now();
        for (const [clientId, encryptedSession] of this.activeSessions.entries()) {
            try {
                const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                const age = now - session.lastActivity;
                if (age > (this.config.security?.auth?.sessionTimeout || 3600000)) { // Default to 1 hour
                    this.removeSession(clientId);
                }
            } catch (decryptError) {
                logger.error('Failed to decrypt session during cleanup:', decryptError);
                this.removeSession(clientId);
            }
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

    /**
     * Create a new token-based session
     * @param {Object} userData - User data including userId, roles, and clientId
     * @returns {Object} Session object with access and refresh tokens
     */
    async createTokenSession(userData) {
        try {
            if (!userData || !userData.userId || !userData.clientId) {
                throw new Error('Invalid user data');
            }

            // Generate tokens
            const tokens = this.tokenAuth.generateTokens(userData);

            // Create session data
            const sessionData = {
                ...tokens,
                userId: userData.userId,
                clientId: userData.clientId,
                roles: userData.roles || [],
                createdAt: Date.now(),
                lastActivity: Date.now()
            };

            // Encrypt and store session
            const encryptedSession = this.sessionEncryption.encryptSession(sessionData, this.encryptionKey);
            this.activeSessions.set(userData.clientId, encryptedSession);

            this.metrics?.authSessionCreationSuccess?.inc();
            return {
                ...tokens,
                expiresIn: this.config.security?.tokenAuth?.accessTokenExpiry || 15 * 60
            };
        } catch (error) {
            logger.error('Token session creation failed:', error);
            this.metrics?.authSessionCreationError?.inc();
            throw error;
        }
    }

    /**
     * Validate a token-based session
     * @param {string} token - Access token to validate
     * @returns {boolean} True if session is valid
     */
    async validateTokenSession(token) {
        try {
            if (!token) {
                return false;
            }

            // Verify token
            const decoded = this.tokenAuth.verifyToken(token, 'access');
            const encryptedSession = this.activeSessions.get(decoded.clientId);

            if (!encryptedSession) {
                return false;
            }

            try {
                const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                
                if (session.accessToken !== token) {
                    return false;
                }

                // Update last activity and re-encrypt
                session.lastActivity = Date.now();
                const updatedEncryptedSession = this.sessionEncryption.encryptSession(session, this.encryptionKey);
                this.activeSessions.set(decoded.clientId, updatedEncryptedSession);

                return true;
            } catch (decryptError) {
                logger.error('Session decryption failed:', decryptError);
                return false;
            }
        } catch (error) {
            logger.error('Token validation failed:', error);
            return false;
        }
    }

    /**
     * Refresh a token-based session
     * @param {string} refreshToken - Refresh token to use
     * @returns {Object} New access and refresh tokens
     */
    async refreshTokenSession(refreshToken) {
        try {
            if (!refreshToken) {
                throw new Error('Refresh token is required');
            }

            // Verify refresh token
            const decoded = this.tokenAuth.verifyToken(refreshToken, 'refresh');
            const encryptedSession = this.activeSessions.get(decoded.clientId);

            if (!encryptedSession) {
                throw new Error('Session not found');
            }

            // Get current session data
            const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
            
            if (session.refreshToken !== refreshToken) {
                throw new Error('Invalid refresh token');
            }

            // Generate new tokens
            const newTokens = this.tokenAuth.refreshTokens(refreshToken);

            // Update session with new tokens
            const updatedSession = {
                ...session,
                ...newTokens,
                lastActivity: Date.now()
            };

            // Encrypt and store updated session
            const updatedEncryptedSession = this.sessionEncryption.encryptSession(updatedSession, this.encryptionKey);
            this.activeSessions.set(decoded.clientId, updatedEncryptedSession);

            return {
                ...newTokens,
                expiresIn: this.config.security?.tokenAuth?.accessTokenExpiry || 15 * 60
            };
        } catch (error) {
            logger.error('Token refresh failed:', error);
            throw error;
        }
    }

    /**
     * Generate OAuth2 authorization URL
     * @param {string} state - State parameter for CSRF protection
     * @param {string} nonce - Nonce for OpenID Connect
     * @returns {string} Authorization URL
     */
    generateOAuth2AuthorizationUrl(state, nonce) {
        try {
            return this.oauth2Service.generateAuthorizationUrl(state, nonce);
        } catch (error) {
            logger.error('Failed to generate OAuth2 authorization URL:', error);
            throw error;
        }
    }

    /**
     * Create OAuth2 session from authorization code
     * @param {string} code - Authorization code
     * @param {string} clientId - Client ID
     * @param {string} clientSecret - Client secret
     * @returns {Promise<Object>} Session object with tokens
     */
    async createOAuth2Session(code, clientId, clientSecret) {
        try {
            const tokens = await this.oauth2Service.exchangeCodeForToken(code, clientId, clientSecret);
            
            // Create session data
            const sessionData = {
                ...tokens,
                clientId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                authType: 'oauth2'
            };

            // Encrypt and store session
            const encryptedSession = this.sessionEncryption.encryptSession(sessionData, this.encryptionKey);
            this.activeSessions.set(clientId, encryptedSession);

            this.metrics?.authSessionCreationSuccess?.inc();
            return tokens;
        } catch (error) {
            logger.error('OAuth2 session creation failed:', error);
            this.metrics?.authSessionCreationError?.inc();
            throw error;
        }
    }

    /**
     * Validate OAuth2 access token
     * @param {string} token - Access token to validate
     * @returns {Promise<boolean>} True if token is valid
     */
    async validateOAuth2Token(token) {
        try {
            await this.oauth2Service.validateAccessToken(token);
            return true;
        } catch (error) {
            logger.error('OAuth2 token validation failed:', error);
            return false;
        }
    }

    /**
     * Refresh OAuth2 access token
     * @param {string} refreshToken - Refresh token
     * @returns {Promise<Object>} New access and refresh tokens
     */
    async refreshOAuth2Token(refreshToken) {
        try {
            const tokens = await this.oauth2Service.refreshAccessToken(refreshToken);
            
            // Update session with new tokens
            const clientId = tokens.client_id; // Assuming client_id is included in token payload
            const encryptedSession = this.activeSessions.get(clientId);
            
            if (encryptedSession) {
                const session = this.sessionEncryption.decryptSession(encryptedSession, this.encryptionKey);
                const updatedSession = {
                    ...session,
                    ...tokens,
                    lastActivity: Date.now()
                };
                
                const updatedEncryptedSession = this.sessionEncryption.encryptSession(updatedSession, this.encryptionKey);
                this.activeSessions.set(clientId, updatedEncryptedSession);
            }

            return tokens;
        } catch (error) {
            logger.error('OAuth2 token refresh failed:', error);
            throw error;
        }
    }

    /**
     * Stop the auth service and clean up resources
     */
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.apiKeyManager.stopRotationInterval();
        this.activeSessions.clear();
    }
}

module.exports = AuthService; 