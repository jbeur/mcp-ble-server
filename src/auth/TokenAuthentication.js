const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const crypto = require('crypto');

class TokenAuthentication {
    constructor(config, metrics) {
        if (!config) {
            throw new Error('Configuration is required');
        }

        this.config = config;
        this.metrics = metrics;

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

            this.metrics?.tokenGenerationSuccess?.inc();
            return { accessToken, refreshToken };
        } catch (error) {
            logger.error('Failed to generate tokens:', error);
            this.metrics?.tokenGenerationError?.inc();
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

            this.metrics?.tokenValidationSuccess?.inc();
            return decoded;
        } catch (error) {
            logger.error('Token verification failed:', error);

            // Only increment error metric once per verification attempt
            this.metrics?.tokenValidationError?.inc();

            // Preserve specific error messages
            if (error.message === 'Invalid token format' || 
                error.message === 'Invalid token type') {
                throw error;
            }

            if (error.name === 'TokenExpiredError') {
                throw new Error('Token expired');
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
            this.metrics?.tokenRefreshSuccess?.inc();
            return newTokens;
        } catch (error) {
            logger.error('Token refresh failed:', error);
            this.metrics?.tokenRefreshError?.inc();

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
}

module.exports = TokenAuthentication; 