const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const crypto = require('crypto');

class TokenAuthentication {
    constructor(config, metrics) {
        this.config = {
            auth: {
                jwtSecret: config?.auth?.jwtSecret || 'default-secret-key',
                sessionDuration: config?.auth?.sessionDuration || '1h',
                maxFailedAttempts: config?.auth?.maxFailedAttempts || 5,
                lockoutDuration: config?.auth?.lockoutDuration || 15 * 60 * 1000 // 15 minutes
            },
            ...config
        };
        this.metrics = metrics || {
            increment: (name) => {
                logger.info(`Metric incremented: ${name}`);
            }
        };
        this.tokenStorage = new Map();
        this.blacklistedTokens = new Set();
        this.failedAttempts = new Map();
        this.cleanupInterval = null;

        // Validate configuration
        const tokenConfig = this.config.security?.tokenAuth;
        if (!tokenConfig?.accessTokenSecret || !tokenConfig?.refreshTokenSecret) {
            throw new Error('Missing required configuration');
        }

        // Validate algorithm
        const supportedAlgorithms = ['HS256', 'HS384', 'HS512'];
        if (!supportedAlgorithms.includes(tokenConfig.algorithm)) {
            throw new Error('Invalid algorithm');
        }

        this.accessTokenSecret = tokenConfig.accessTokenSecret;
        this.refreshTokenSecret = tokenConfig.refreshTokenSecret;
        this.accessTokenExpiry = tokenConfig.accessTokenExpiry || 15 * 60; // 15 minutes in seconds
        this.refreshTokenExpiry = tokenConfig.refreshTokenExpiry || 7 * 24 * 60 * 60; // 7 days in seconds
        this.issuer = tokenConfig.issuer || 'mcp-ble-server';
        this.algorithm = tokenConfig.algorithm || 'HS256';
    }

    /**
     * Generate access and refresh tokens for a user
     * @param {Object} userData - User data to include in tokens
     * @returns {Object} Object containing access and refresh tokens
     */
    generateTokens(userData) {
        try {
            if (!userData || typeof userData !== 'object' || !userData.userId) {
                throw new Error('Invalid user data');
            }

            const now = Math.floor(Date.now() / 1000);
            const jitter = Math.floor(Math.random() * 30); // Add random jitter to prevent token reuse

            // Generate access token
            const accessToken = jwt.sign(
                {
                    sub: userData.userId,
                    roles: userData.roles || [],
                    clientId: userData.clientId,
                    type: 'access',
                    iat: now,
                    exp: now + this.accessTokenExpiry + jitter,
                    iss: this.issuer,
                    jti: this._generateTokenId() // Add unique token ID
                },
                this.accessTokenSecret,
                { algorithm: this.algorithm }
            );

            // Generate refresh token
            const refreshToken = jwt.sign(
                {
                    sub: userData.userId,
                    roles: userData.roles || [],
                    clientId: userData.clientId,
                    type: 'refresh',
                    iat: now,
                    exp: now + this.refreshTokenExpiry + jitter,
                    iss: this.issuer,
                    jti: this._generateTokenId() // Add unique token ID
                },
                this.refreshTokenSecret,
                { algorithm: this.algorithm }
            );

            this.metrics.increment('auth.token.generation.success');
            return { accessToken, refreshToken };
        } catch (error) {
            logger.error('Failed to generate tokens:', error);
            this.metrics.increment('auth.token.generation.error');
            throw error;
        }
    }

    /**
     * Verify a token
     * @param {string} token - Token to verify
     * @param {string} expectedType - Expected token type ('access' or 'refresh')
     * @returns {Object} Decoded token payload
     */
    verifyToken(token, expectedType) {
        try {
            if (typeof token !== 'string' || !token.includes('.') || token.split('.').length !== 3) {
                throw new Error('Invalid token format');
            }

            // First decode without verification to check the token type
            const decodedWithoutVerification = jwt.decode(token);
            if (!decodedWithoutVerification) {
                throw new Error('Invalid token format');
            }

            if (decodedWithoutVerification.type !== expectedType) {
                throw new Error('Invalid token type');
            }

            const secret = expectedType === 'access' ? this.accessTokenSecret : this.refreshTokenSecret;
            const decoded = jwt.verify(token, secret, {
                algorithms: [this.algorithm],
                issuer: this.issuer
            });

            this.metrics.increment('auth.token.validation.success');
            return decoded;
        } catch (error) {
            logger.error('Token verification failed:', error);

            // Only increment error metric once per verification attempt
            this.metrics.increment('auth.token.validation.error');

            // Preserve specific error messages
            if (error.message === 'Invalid token format' || 
                error.message === 'Invalid token type') {
                throw error;
            }

            if (error.name === 'TokenExpiredError') {
                throw new Error(`${expectedType === 'refresh' ? 'Refresh token' : 'Token'} expired`);
            }

            throw new Error('Invalid token');
        }
    }

    /**
     * Refresh tokens using a valid refresh token
     * @param {string} refreshToken - Current refresh token
     * @returns {Object} New access and refresh tokens
     */
    refreshTokens(refreshToken) {
        try {
            // Verify the refresh token
            const decoded = this.verifyToken(refreshToken, 'refresh');

            // Generate new tokens with the same user data
            const userData = {
                userId: decoded.sub,
                roles: decoded.roles,
                clientId: decoded.clientId
            };

            const newTokens = this.generateTokens(userData);
            this.metrics.increment('auth.token.refresh.success');
            return newTokens;
        } catch (error) {
            logger.error('Token refresh failed:', error);
            this.metrics.increment('auth.token.refresh.error');

            if (error.message === 'Token expired') {
                throw new Error('Refresh token expired');
            }
            throw error;
        }
    }

    /**
     * Generate a unique token ID
     * @private
     */
    _generateTokenId() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Generate a new token for a client
     * @param {string} clientId - Client ID
     * @param {string} type - Token type (access or refresh)
     * @returns {Promise<string>} Generated token
     */
    async generateToken(clientId, type = 'access') {
        try {
            if (!clientId) {
                throw new Error('Client ID is required');
            }

            const now = Math.floor(Date.now() / 1000);
            const expiresIn = type === 'access' ? 3600 : 86400; // 1 hour for access, 24 hours for refresh
            const jitter = Math.floor(Math.random() * 30); // Add random jitter to prevent token reuse

            const token = jwt.sign(
                {
                    sub: clientId,
                    type: type,
                    iat: now,
                    exp: now + expiresIn + jitter
                },
                this.config.auth.jwtSecret,
                { algorithm: 'HS256' }
            );

            this.tokenStorage.set(token, {
                clientId,
                type,
                createdAt: now,
                expiresAt: now + expiresIn + jitter
            });

            this.metrics.increment('auth.token.generation.success');
            return token;
        } catch (error) {
            this.metrics.increment('auth.token.generation.error');
            logger.error('Error generating token:', error);
            throw error;
        }
    }

    /**
     * Validate a token
     * @param {string} token - Token to validate
     * @returns {boolean} Whether the token is valid
     */
    async validateToken(token) {
        try {
            if (typeof token !== 'string' || !token.includes('.') || token.split('.').length !== 3) {
                return false;
            }

            // Check if token is blacklisted
            if (this.blacklistedTokens.has(token)) {
                return false;
            }

            // Verify token signature and expiration
            const decoded = jwt.verify(token, this.accessTokenSecret, {
                algorithms: [this.algorithm],
                issuer: this.issuer
            });

            // Check if token exists in storage
            const tokenData = this.tokenStorage.get(token);
            if (!tokenData) {
                return false;
            }

            // Check if token has expired
            if (Date.now() / 1000 > tokenData.expiresAt) {
                this.tokenStorage.delete(token);
                return false;
            }

            this.metrics.increment('auth.token.validation.success');
            return true;
        } catch (error) {
            logger.error('Token validation failed:', error);
            this.metrics.increment('auth.token.validation.error');
            return false;
        }
    }

    /**
     * Blacklist a token
     * @param {string} token - Token to blacklist
     */
    async blacklistToken(token) {
        try {
            if (!token) {
                throw new Error('Token is required');
            }

            // Remove from active storage
            this.tokenStorage.delete(token);

            // Add to blacklist
            this.blacklistedTokens.add(token);

            this.metrics.increment('auth.token.blacklist.success');
        } catch (error) {
            logger.error('Failed to blacklist token:', error);
            this.metrics.increment('auth.token.blacklist.error');
            throw error;
        }
    }

    /**
     * Clean up expired tokens
     */
    async cleanup() {
        try {
            // Stop cleanup interval if it exists
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            
            // Clear token storage
            this.tokenStorage.clear();
            
            // Clear blacklisted tokens
            this.blacklistedTokens.clear();
            
            logger.info('TokenAuthentication cleanup completed');
        } catch (error) {
            logger.error('Error during TokenAuthentication cleanup:', error);
            throw error;
        }
    }

    /**
     * Stop the service and clean up resources
     */
    async stop() {
        try {
            // Stop cleanup interval if it exists
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            
            await this.cleanup();
            logger.info('TokenAuthentication stopped');
        } catch (error) {
            logger.error('Error stopping TokenAuthentication:', error);
            throw error;
        }
    }
}

module.exports = TokenAuthentication; 